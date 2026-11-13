'use client';

import React, { useEffect, useRef, useState } from 'react';
import { DEMO_USERS, MarketplaceUser } from '@/lib/demo-users';

interface ChatMessage {
  id: string;
  senderId: string;
  recipientId: string;
  text: string;
  translatedText?: string;
  timestamp: number;
  type: 'text' | 'offer' | 'system';
  offerAmount?: string;
  offerStatus?: 'Pending' | 'Accepted';
}

function getThreadKey(userA: string, userB: string): string {
  return [userA, userB].sort().join('__');
}

export default function LinguaDeskPage() {
  const [currentUser, setCurrentUser] = useState<MarketplaceUser>(DEMO_USERS[0]);
  const [activePeerId, setActivePeerId] = useState<string>('seller_1');
  const [sdkStatus, setSdkStatus] = useState<'Connecting...' | 'Connected (Nexconn Live)' | 'SDK Error'>('Connecting...');
  const [sdkErrorDetail, setSdkErrorDetail] = useState<string>('');
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const [unreadPeers, setUnreadPeers] = useState<Record<string, number>>({});
  const [inputText, setInputText] = useState('');
  const [offerPrice, setOfferPrice] = useState('42,500');
  const [aiSuggestion, setAiSuggestion] = useState<string>('');
  const [ticketPriority, setTicketPriority] = useState<string>('GENERAL INQUIRY');
  const [escalated, setEscalated] = useState<boolean>(false);
  const [refundIssued, setRefundIssued] = useState<boolean>(false);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);

  const sdkModuleRef = useRef<any>(null);
  const initializedRef = useRef<boolean>(false);
  const currentUserRef = useRef<MarketplaceUser>(DEMO_USERS[0]);
  const activePeerIdRef = useRef<string>('seller_1');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const receiveIncomingRef = useRef<(senderId: string, rawText: string) => Promise<void>>(
    async () => {}
  );

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    activePeerIdRef.current = activePeerId;
  }, [activePeerId]);

  function selectPeer(peerId: string) {
    setActivePeerId(peerId);
    activePeerIdRef.current = peerId;
    setUnreadPeers((prev) => ({ ...prev, [peerId]: 0 }));
  }

  async function handleSwitchRole(user: MarketplaceUser) {
    setCurrentUser(user);
    currentUserRef.current = user;

    const nextPeer =
      activePeerIdRef.current !== user.userId
        ? activePeerIdRef.current
        : user.userId === 'buyer_1'
        ? 'seller_1'
        : 'buyer_1';

    selectPeer(nextPeer);

    await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.userId }),
    });

    await connectNexconnSDK(user.userId);
  }

  async function connectNexconnSDK(overrideUserId?: string) {
    setSdkStatus('Connecting...');
    setSdkErrorDetail('');

    try {
      const targetUserId = overrideUserId || currentUserRef.current.userId;
      const tokenRes = await fetch('/api/chat/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: targetUserId }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.token) {
        throw new Error(tokenData.error || 'Failed to fetch Nexconn token');
      }

      const appKey = process.env.NEXT_PUBLIC_NEXCONN_APP_KEY!;
      const chatSdk: any = await import('@nexconn/chat');
      const { NCEngine, LogLevel, AreaCode, MessageHandler } = chatSdk;
      sdkModuleRef.current = chatSdk;

      if (!initializedRef.current) {
        NCEngine.initialize({
          appKey,
          logLevel: LogLevel?.WARN ?? 2,
          areaCode: AreaCode?.SG ?? 'SG',
        });

        const handler = new MessageHandler({
          async onMessageReceived({ messages: incomingList }: { messages: any[] }) {
            for (const msg of incomingList || []) {
              const rawContent =
                msg?.content?.text ||
                msg?.text ||
                (typeof msg?.content === 'string' ? msg.content : '');
              if (!rawContent) continue;
              const sender = msg?.senderUserId || activePeerIdRef.current;
              await receiveIncomingRef.current(sender, rawContent);
            }
          },
        });

        NCEngine.addMessageHandler('linguadesk-msg-handler', handler);
        initializedRef.current = true;
      } else if (typeof NCEngine.disconnect === 'function') {
        await NCEngine.disconnect();
      }

      const connectResult = await NCEngine.connect({ token: tokenData.token });
      if (connectResult && connectResult.isOk === false) {
        throw new Error(
          `Nexconn connect failed (code ${connectResult.code ?? 'unknown'}): ${connectResult.msg || 'Check App Key & Singapore region'}`
        );
      }

      setSdkStatus('Connected (Nexconn Live)');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSdkStatus('SDK Error');
      setSdkErrorDetail(msg);
    }
  }

  async function receiveIncomingPayload(senderId: string, rawText: string) {
    setIsTranslating(true);
    let parsed: Partial<ChatMessage> & { _senderId?: string } = { text: rawText, type: 'text' };
    try {
      if (rawText.startsWith('{')) {
        parsed = JSON.parse(rawText);
      }
    } catch {
      // Plain text message
    }

    const realSenderId = parsed._senderId || senderId || activePeerIdRef.current;
    const activeUser = currentUserRef.current;
    const targetLang = activeUser.userId === 'buyer_1' ? 'Hindi' : 'English';

    const trRes = await fetch('/api/ai/assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'translate', text: parsed.text || rawText, targetLang }),
    });
    const { translated } = await trRes.json();

    const triageRes = await fetch('/api/ai/assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'triage', text: parsed.text || rawText }),
    });
    const triage = await triageRes.json();
    if (triage.priority) setTicketPriority(triage.priority);
    if (triage.suggestedReply) setAiSuggestion(triage.suggestedReply);

    setIsTranslating(false);

    const threadKey = getThreadKey(activeUser.userId, realSenderId);
    const newMsg: ChatMessage = {
      id: `${Date.now()}-${Math.random()}`,
      senderId: realSenderId,
      recipientId: activeUser.userId,
      text: parsed.text || rawText,
      translatedText: translated !== (parsed.text || rawText) ? translated : undefined,
      timestamp: Date.now(),
      type: parsed.type || 'text',
      offerAmount: parsed.offerAmount,
      offerStatus: parsed.offerStatus,
    };

    setThreads((prev) => ({
      ...prev,
      [threadKey]: [...(prev[threadKey] || []), newMsg],
    }));

    if (realSenderId !== activePeerIdRef.current) {
      setUnreadPeers((prev) => ({
        ...prev,
        [realSenderId]: (prev[realSenderId] || 0) + 1,
      }));
    }
  }

  useEffect(() => {
    receiveIncomingRef.current = receiveIncomingPayload;
  });

  async function transmitOverNexconn(
    payload: Omit<ChatMessage, 'id' | 'senderId' | 'recipientId' | 'timestamp'>,
    overrideTargetPeerId?: string
  ) {
    setIsTranslating(true);
    const sender = currentUserRef.current.userId;
    const targetPeer = overrideTargetPeerId || activePeerIdRef.current;

    const wirePayload = JSON.stringify({
      ...payload,
      _senderId: sender,
    });

    const sdk = sdkModuleRef.current;
    if (sdk?.DirectChannel && sdk?.SendTextMessageParams) {
      const channel = new sdk.DirectChannel(targetPeer);
      const params = new sdk.SendTextMessageParams({ text: wirePayload });
      const sendRes = await channel.sendMessage(params);
      if (sendRes && sendRes.isOk === false) {
        setSdkErrorDetail(`Send failed (code ${sendRes.code ?? 'unknown'}): ${sendRes.msg || ''}`);
      }
    }

    const targetLang = targetPeer === 'buyer_1' ? 'Hindi' : 'English';
    const trRes = await fetch('/api/ai/assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'translate', text: payload.text, targetLang }),
    });
    const { translated } = await trRes.json();
    setIsTranslating(false);

    const threadKey = getThreadKey(sender, targetPeer);
    const sentMsg: ChatMessage = {
      id: `${Date.now()}-${Math.random()}`,
      senderId: sender,
      recipientId: targetPeer,
      text: payload.text,
      translatedText: translated !== payload.text ? translated : undefined,
      timestamp: Date.now(),
      type: payload.type,
      offerAmount: payload.offerAmount,
      offerStatus: payload.offerStatus,
    };

    setThreads((prev) => ({
      ...prev,
      [threadKey]: [...(prev[threadKey] || []), sentMsg],
    }));
  }

  async function handleSendText(e: React.FormEvent) {
    e.preventDefault();
    if (!inputText.trim()) return;
    const text = inputText.trim();
    setInputText('');
    await transmitOverNexconn({ text, type: 'text' });
  }

  async function handleSendOfferCard() {
    await transmitOverNexconn({
      text: `Exclusive Counter-Offer for Lenovo Legion Pro 5: ₹${offerPrice}`,
      type: 'offer',
      offerAmount: `₹${offerPrice}`,
      offerStatus: 'Pending',
    });
  }

  async function handleEscalateToAgent() {
    setEscalated(true);
    setTicketPriority('URGENT ESCALATION');
    selectPeer('agent_1');
    await transmitOverNexconn(
      {
        text: 'Escalated to Support Lead Priya (agent_1) with AI order & translation summary.',
        type: 'system',
      },
      'agent_1'
    );
  }

  async function handleIssueSupportRefund() {
    setRefundIssued(true);
    setTicketPriority('RESOLVED • REFUND APPROVED');
    await transmitOverNexconn({
      text: 'Support Lead Priya approved an instant Escrow Refund of ₹45,000 for Order #ORD-8821.',
      type: 'system',
    });
  }

  function handleAcceptOffer(msgId: string) {
    const threadKey = getThreadKey(currentUser.userId, activePeerId);
    setThreads((prev) => ({
      ...prev,
      [threadKey]: (prev[threadKey] || []).map((m) =>
        m.id === msgId ? { ...m, offerStatus: 'Accepted' } : m
      ),
    }));
  }

  useEffect(() => {
    connectNexconnSDK();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentThreadKey = getThreadKey(currentUser.userId, activePeerId);
  const currentMessages = threads[currentThreadKey] || [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages.length]);

  const activePeer = DEMO_USERS.find((u) => u.userId === activePeerId) || DEMO_USERS[1];
  const isBuyer = currentUser.userId === 'buyer_1';
  const isSeller = currentUser.userId === 'seller_1';
  const isAgent = currentUser.userId === 'agent_1';

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#6D5DFB] via-[#C084FC] to-[#FB923C] p-3 sm:p-5 lg:p-6 flex items-center justify-center font-sans text-zinc-900">
      <div className="w-full max-w-[1420px] min-h-[calc(100vh-3rem)] bg-[#FAFAFC] rounded-[32px] shadow-[0_24px_80px_rgba(17,12,46,0.22)] border border-white/80 flex flex-col overflow-hidden">
        <header className="px-6 lg:px-8 py-4 bg-white/80 backdrop-blur-md border-b border-zinc-200/70 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-zinc-950 flex items-center justify-center text-white font-black text-lg shadow-sm">
              L
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight text-zinc-950">LinguaDesk</span>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
                  AI Commerce
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                Real-Time Bilingual Marketplace &amp; Triage
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-1 bg-zinc-100/90 p-1.5 rounded-full border border-zinc-200/80">
            {DEMO_USERS.map((u) => {
              const active = currentUser.userId === u.userId;
              return (
                <button
                  key={u.userId}
                  suppressHydrationWarning
                  onClick={() => handleSwitchRole(u)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    active
                      ? 'bg-gradient-to-r from-[#7C3AED] to-[#EC4899] text-white shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-950'
                  }`}
                >
                  {u.role}: {u.name.split(' ')[0]}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-zinc-600 bg-white px-3.5 py-1.5 rounded-full border border-zinc-200 shadow-2xs">
              <span className="text-amber-500">&#9733;</span>
              <span>4.9/5 Escrow</span>
            </div>
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-950 text-white text-xs font-medium shadow-sm">
              <span
                className={`h-2 w-2 rounded-full ${
                  sdkStatus === 'Connected (Nexconn Live)'
                    ? 'bg-emerald-400 animate-pulse'
                    : sdkStatus === 'Connecting...'
                    ? 'bg-amber-400'
                    : 'bg-rose-500'
                }`}
              />
              <span>{sdkStatus}</span>
            </div>
          </div>
        </header>

        {sdkErrorDetail && (
          <div className="bg-rose-50 border-b border-rose-200 px-8 py-2 text-xs text-rose-700 font-medium">
            Connection Notice: {sdkErrorDetail}
          </div>
        )}

        <main className="flex-1 grid grid-cols-1 lg:grid-cols-12">
          <aside className="lg:col-span-3 border-r border-zinc-200/70 p-5 space-y-5 bg-white/60">
            <div className="space-y-1.5 pt-1">
              <h2 className="text-2xl font-extrabold tracking-tight leading-tight bg-gradient-to-r from-[#7C3AED] via-[#C026D3] to-[#F97316] bg-clip-text text-transparent">
                AI analysis for live deal talks
              </h2>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Auto-translates Hindi &harr; English in real time, scores buyer intent, and closes escrow offers in-thread.
              </p>
            </div>

            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                Marketplace Channels
              </div>
              <div className="space-y-2">
                {DEMO_USERS.filter((u) => u.userId !== currentUser.userId).map((peer) => {
                  const selected = activePeerId === peer.userId;
                  const unread = unreadPeers[peer.userId] || 0;
                  return (
                    <button
                      key={peer.userId}
                      suppressHydrationWarning
                      onClick={() => selectPeer(peer.userId)}
                      className={`w-full text-left p-3 rounded-2xl border transition-all flex items-center justify-between ${
                        selected
                          ? 'bg-white border-violet-300 shadow-[0_8px_24px_rgba(124,58,237,0.08)]'
                          : 'bg-zinc-50/80 border-zinc-200/70 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-9 w-9 rounded-xl flex items-center justify-center text-xs font-bold ${
                            selected
                              ? 'bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white'
                              : 'bg-zinc-200/80 text-zinc-700'
                          }`}
                        >
                          {peer.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-semibold text-sm text-zinc-900">{peer.name}</div>
                          <div className="text-xs text-zinc-500">
                            {peer.role} &bull; {peer.language}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {unread > 0 && (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-500 text-white">
                            {unread}
                          </span>
                        )}
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl bg-[#111318] text-white p-4 space-y-3 shadow-xl shadow-zinc-900/10">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-violet-300">
                  Order #ORD-8821
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-emerald-300 font-medium">
                  Escrow Protected
                </span>
              </div>
              <div>
                <div className="font-bold text-sm">Lenovo Legion Pro 5 (RTX 4060)</div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  Listed ₹45,000 &bull; Verified Seller
                </div>
              </div>
              <div className="flex items-center gap-1 h-5 pt-1">
                {[35, 75, 50, 95, 65, 85, 45, 90, 60, 40, 80, 55, 70, 30, 60].map((h, idx) => (
                  <span
                    key={idx}
                    style={{ height: `${h}%` }}
                    className="flex-1 rounded-full bg-gradient-to-t from-violet-500 to-orange-400 opacity-85"
                  />
                ))}
              </div>
              <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs">
                <span className="text-zinc-400">Live Triage</span>
                <span className="px-2.5 py-0.5 rounded-full bg-gradient-to-r from-violet-500/30 to-orange-500/30 text-orange-200 border border-white/15 font-semibold text-[10px]">
                  {ticketPriority}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                {isBuyer ? 'Quick Buyer Prompts' : isSeller ? 'Quick Seller Replies' : 'Quick Support Macros'}
              </div>
              {(isBuyer
                ? [
                    'Namaste, kya is laptop par discount milega?',
                    'Kya aap 42500 mein de sakte hain?',
                    'Mera order abhi tak nahi aaya, mujhe refund chahiye',
                  ]
                : isSeller
                ? [
                    'Hello Aarav! I can offer ₹42,500 with free express delivery.',
                    'Sending the official escrow offer card now—valid for 2 hours.',
                    'Yes, 1-year Lenovo warranty invoice is included.',
                  ]
                : [
                    'Hi Aarav, I am reviewing your Order #ORD-8821 escrow protection now.',
                    'Your refund request has been prioritized and verified.',
                    'Seller Rohan has been notified—your funds are 100% safe.',
                  ]
              ).map((phrase) => (
                <button
                  key={phrase}
                  suppressHydrationWarning
                  onClick={() => setInputText(phrase)}
                  className="w-full text-left text-xs p-2.5 rounded-xl bg-white hover:bg-violet-50/70 border border-zinc-200/80 hover:border-violet-300 text-zinc-700 transition truncate"
                >
                  &ldquo;{phrase}&rdquo;
                </button>
              ))}
            </div>
          </aside>

          <section className="lg:col-span-6 flex flex-col border-r border-zinc-200/70 h-[calc(100vh-115px)] bg-gradient-to-b from-white via-[#FAF8FF] to-[#FFF7F3]">
            <div className="px-6 py-3.5 border-b border-zinc-200/70 flex items-center justify-between bg-white/80 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-violet-100 to-orange-100 border border-violet-200 flex items-center justify-center font-bold text-sm text-violet-700">
                  {activePeer.name[0]}
                </div>
                <div>
                  <div className="font-bold text-sm text-zinc-950 flex items-center gap-2">
                    {activePeer.name}
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-zinc-100 text-zinc-600 font-medium">
                      {activePeer.role}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500">
                    Chatting as <strong className="text-violet-600">{currentUser.name}</strong> &harr;{' '}
                    <strong className="text-orange-600">{activePeer.name}</strong>
                  </div>
                </div>
              </div>

              {isBuyer && (
                !escalated ? (
                  <button
                    suppressHydrationWarning
                    onClick={handleEscalateToAgent}
                    className="text-xs px-4 py-2 rounded-full bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 font-semibold shadow-2xs transition"
                  >
                    Escalate to Agent
                  </button>
                ) : (
                  <span className="text-xs px-3.5 py-1.5 rounded-full bg-violet-100 text-violet-700 font-semibold">
                    Priya (Support Lead) In Room
                  </span>
                )
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {currentMessages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto space-y-3">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-600 to-orange-500 text-white flex items-center justify-center text-lg font-bold shadow-lg shadow-violet-500/20">
                    &#10024;
                  </div>
                  <div className="text-base font-bold text-zinc-900">
                    Direct Thread with {activePeer.name}
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Type any custom message in Hindi, Hinglish, or English below—or use a quick prompt on the left.
                  </p>
                </div>
              )}

              {currentMessages.map((m) => {
                const isMine = m.senderId === currentUser.userId;
                if (m.type === 'system') {
                  return (
                    <div key={m.id} className="flex justify-center my-2">
                      <span className="inline-flex items-center gap-2 text-xs px-4 py-1.5 rounded-full bg-violet-100/90 text-violet-800 font-medium">
                        &#10024; {m.text}
                      </span>
                    </div>
                  );
                }

                return (
                  <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`max-w-md rounded-2xl px-4 py-3.5 text-sm space-y-2 transition-all ${
                        isMine
                          ? 'bg-gradient-to-r from-[#7C3AED] to-[#D946EF] text-white rounded-br-sm shadow-[0_10px_25px_rgba(124,58,237,0.22)]'
                          : 'bg-white border border-zinc-200/90 text-zinc-900 rounded-bl-sm shadow-[0_8px_24px_rgba(15,23,42,0.05)]'
                      }`}
                    >
                      {m.type === 'offer' ? (
                        <div className="space-y-2.5 min-w-[240px]">
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-[10px] uppercase tracking-wider font-bold ${
                                isMine ? 'text-white/80' : 'text-violet-600'
                              }`}
                            >
                              Escrow Offer Card
                            </span>
                            <span
                              className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold ${
                                m.offerStatus === 'Accepted'
                                  ? 'bg-emerald-500 text-white'
                                  : isMine
                                  ? 'bg-white/20 text-white'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {m.offerStatus}
                            </span>
                          </div>
                          <div className="font-extrabold text-2xl tracking-tight">{m.offerAmount}</div>
                          <div className={`text-xs ${isMine ? 'text-white/90' : 'text-zinc-600'}`}>
                            {m.text}
                          </div>
                          {isBuyer && !isMine && m.offerStatus === 'Pending' && (
                            <button
                              suppressHydrationWarning
                              onClick={() => handleAcceptOffer(m.id)}
                              className="w-full mt-1 py-2 rounded-full bg-zinc-950 hover:bg-zinc-800 text-white font-semibold text-xs transition"
                            >
                              Accept &amp; Lock Offer
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="leading-relaxed font-medium">{m.text}</div>
                          {m.translatedText && (
                            <div
                              className={`pt-2 border-t text-xs flex items-start gap-2 ${
                                isMine
                                  ? 'border-white/20 text-white/90'
                                  : 'border-zinc-100 text-zinc-600'
                              }`}
                            >
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0 ${
                                  isMine
                                    ? 'bg-white/20 text-white'
                                    : 'bg-violet-100 text-violet-700'
                                }`}
                              >
                                AI
                              </span>
                              <span className="italic">{m.translatedText}</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-400 mt-1 px-1">
                      {isMine ? 'You' : activePeer.name.split(' ')[0]} &bull;{' '}
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })}

              {isTranslating && (
                <div className="text-xs text-violet-600 font-medium animate-pulse">
                  &#10024; Analyzing &amp; translating...
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <form
              onSubmit={handleSendText}
              className="p-4 border-t border-zinc-200/70 bg-white/90 flex items-center gap-2.5"
            >
              <input
                type="text"
                suppressHydrationWarning
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Type any custom message to ${activePeer.name}...`}
                className="flex-1 bg-zinc-100/80 border border-zinc-200 rounded-full px-5 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-violet-400 transition"
              />
              <button
                type="submit"
                suppressHydrationWarning
                className="px-6 py-3 rounded-full bg-gradient-to-r from-[#7C3AED] to-[#EC4899] hover:opacity-95 font-semibold text-sm text-white shadow-md shadow-violet-500/20 transition"
              >
                Send &rarr;
              </button>
            </form>
          </section>

          {/* Role-Specific Right Sidebar */}
          <aside className="lg:col-span-3 p-5 space-y-5 bg-white/60">
            {/* SELLER ONLY: Counter-Offer Card */}
            {isSeller && (
              <div className="p-4 rounded-2xl bg-white border border-zinc-200/80 shadow-[0_8px_24px_rgba(15,23,42,0.04)] space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                    Seller Counter-Offer
                  </h2>
                  <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                    Instant Escrow
                  </span>
                </div>
                <div className="relative">
                  <span className="absolute left-4 top-2.5 text-sm font-bold text-zinc-400">₹</span>
                  <input
                    type="text"
                    suppressHydrationWarning
                    value={offerPrice}
                    onChange={(e) => setOfferPrice(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-8 pr-3 py-2 text-sm font-bold text-zinc-900 focus:outline-none focus:border-violet-400"
                  />
                </div>
                <button
                  suppressHydrationWarning
                  onClick={handleSendOfferCard}
                  className="w-full py-2.5 rounded-full bg-zinc-950 hover:bg-zinc-800 text-white text-xs font-semibold transition shadow-sm"
                >
                  Send Interactive Offer Card
                </button>
              </div>
            )}

            {/* BUYER ONLY: Buyer Escrow Protection Card */}
            {isBuyer && (
              <div className="p-4 rounded-2xl bg-white border border-zinc-200/80 shadow-[0_8px_24px_rgba(15,23,42,0.04)] space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                    Buyer Escrow Shield
                  </h2>
                  <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                    100% Insured
                  </span>
                </div>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  Your payment is held safely in LinguaDesk Escrow until you inspect and confirm delivery. When Seller Rohan sends an offer card, click <strong>Accept &amp; Lock Offer</strong> inside the chat.
                </p>
              </div>
            )}

            {/* SUPPORT AGENT ONLY: Refund & Dispute Resolution Card */}
            {isAgent && (
              <div className="p-4 rounded-2xl bg-white border border-zinc-200/80 shadow-[0_8px_24px_rgba(15,23,42,0.04)] space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                    Support Resolution Desk
                  </h2>
                  <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                    Priority Queue
                  </span>
                </div>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  Review translated buyer-seller logs and authorize instant escrow protection for Order #ORD-8821.
                </p>
                <button
                  suppressHydrationWarning
                  disabled={refundIssued}
                  onClick={handleIssueSupportRefund}
                  className={`w-full py-2.5 rounded-full text-xs font-semibold transition shadow-sm ${
                    refundIssued
                      ? 'bg-emerald-100 text-emerald-800 cursor-default'
                      : 'bg-zinc-950 hover:bg-zinc-800 text-white'
                  }`}
                >
                  {refundIssued ? '✓ Escrow Refund Authorized' : 'Authorize Instant Escrow Refund'}
                </button>
              </div>
            )}

            {/* AI Copilot Insights (Context-Aware per Role) */}
            <div className="p-4 rounded-2xl bg-gradient-to-br from-violet-50 via-white to-orange-50 border border-violet-200/70 shadow-[0_8px_24px_rgba(124,58,237,0.06)] space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-violet-700 flex items-center gap-1.5">
                  <span>&#10024;</span> AI Copilot Insights
                </h2>
                <span className="text-[10px] font-semibold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">
                  Live
                </span>
              </div>
              <p className="text-xs text-zinc-600 leading-relaxed">
                {aiSuggestion ||
                  (isBuyer
                    ? 'Ask about discounts, warranty, or shipping in Hindi—AI translates automatically for the seller.'
                    : isSeller
                    ? 'AI Copilot monitors buyer negotiation intent and drafts high-converting counter-offers.'
                    : 'AI Copilot summarizes multilingual dispute context and suggests instant resolution replies.')}
              </p>
              {aiSuggestion && !isBuyer && (
                <button
                  suppressHydrationWarning
                  onClick={() => setInputText(aiSuggestion)}
                  className="w-full py-2 rounded-full bg-gradient-to-r from-[#7C3AED] to-[#EC4899] text-white text-xs font-semibold shadow-sm hover:opacity-95 transition"
                >
                  Insert AI Suggested Reply
                </button>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-white border border-zinc-200/80 space-y-2.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Real-Time Engine Stats
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-100">
                  <div className="text-[10px] text-zinc-400 font-medium">Latency</div>
                  <div className="text-sm font-extrabold text-zinc-900 mt-0.5">&lt; 180 ms</div>
                </div>
                <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-100">
                  <div className="text-[10px] text-zinc-400 font-medium">Nexconn Node</div>
                  <div className="text-sm font-extrabold text-emerald-600 mt-0.5">SG-Live</div>
                </div>
              </div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}