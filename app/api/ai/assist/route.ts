import { NextResponse } from 'next/server';

const DICTIONARY: Record<string, string> = {
  'namaste, kya is laptop par discount milega?': 'Hello, can I get a discount on this laptop?',
  'mera order abhi tak nahi aaya, mujhe refund chahiye': 'My order has not arrived yet, I want a refund.',
  'kya aap 42500 mein de sakte hain?': 'Can you give it for ₹42,500?',
  'hello, can i get a discount on this laptop?': 'नमस्ते, क्या इस लैपटॉप पर डिस्काउंट मिलेगा?',
  'yes! i can offer you a special bundle price of ₹42,500.': 'हाँ! मैं आपको ₹42,500 का विशेष बंडल मूल्य दे सकता हूँ।',
};

export async function POST(req: Request) {
  const { action, text, targetLang = 'English' } = await req.json();

  if (action === 'translate') {
    const clean = (text || '').trim();
    const lower = clean.toLowerCase();

    try {
      const tl = targetLang === 'Hindi' ? 'hi' : 'en';
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(clean)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const translated = data?.[0]?.map((item: string[]) => item[0]).join('') || DICTIONARY[lower] || clean;
        return NextResponse.json({ translated });
      }
    } catch {
      // Offline fallback
    }

    return NextResponse.json({
      translated: DICTIONARY[lower] || `[${targetLang}] ${clean}`,
    });
  }

  if (action === 'triage') {
    const lower = (text || '').toLowerCase();
    const isUrgent = lower.includes('refund') || lower.includes('damaged') || lower.includes('late') || lower.includes('nahi aaya');
    const isOffer = lower.includes('discount') || lower.includes('price') || lower.includes('offer') || lower.includes('₹') || lower.includes('42');

    return NextResponse.json({
      priority: isUrgent ? 'URGENT ESCALATION' : isOffer ? 'PRICE NEGOTIATION' : 'GENERAL INQUIRY',
      suggestedReply: isUrgent
        ? 'I completely understand your concern. I am looping in our Support Lead Priya right now with your order ID #ORD-8821 to process this immediately.'
        : isOffer
        ? 'Thanks for reaching out! I can send you a special buyer offer for ₹42,500 with free express shipping.'
        : 'Hello! Thank you for contacting Rohan Tech Store. How can I help with your order today?',
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
