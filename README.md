# LinguaDesk — Real-Time Bilingual Marketplace & AI Support Workspace

**Nexconn Build Challenge 2026 — Marketplace & Support Track**  
**Nexconn App Key:** `n19jmcy5nw3l9`

LinguaDesk is an AI-powered, real-time bilingual commerce and customer support platform built on the **Nexconn Chat SDK (`@nexconn/chat`)**. It enables regional buyers, independent sellers, and human support agents to negotiate, lock escrow offers, and resolve post-purchase disputes seamlessly across Hindi/Hinglish and English.

## Key Features

- **Real-Time Cross-Language Chat (`@nexconn/chat`):** Connects buyers, sellers, and support leads over low-latency Singapore WebSocket nodes (`AreaCode.SG`) with automatic Hindi ↔ English neural translation.
- **In-Thread Escrow Counter-Offer Cards:** Sellers send structured price-offer cards directly inside the chat stream; buyers accept and lock the escrow price with one click.
- **AI Support Copilot & Live Triage:** Automatically classifies incoming messages (`GENERAL INQUIRY`, `PRICE NEGOTIATION`, `URGENT ESCALATION`) and generates context-aware suggested replies.
- **Role-Based Workspaces & Instant Escalation:** Isolated 1:1 threads across three personas (`Buyer: Aarav`, `Seller: Rohan`, `Support Agent: Priya`) with one-click escalation and instant escrow refund authorization.

## Nexconn SDK Integration Architecture

1. **Server-Side Token Signing (`lib/nexconn-server.ts` & `app/api/chat/token/route.ts`):** Generates SHA-1 signed authentication tokens (`App-Key`, `Nonce`, `Timestamp`, `Signature`) against Nexconn's Singapore REST API (`/user/getToken.json`) for `buyer_1`, `seller_1`, and `agent_1`.
2. **Client Engine & Message Listeners (`app/page.tsx`):** Initializes `NCEngine.initialize({ appKey: 'n19jmcy5nw3l9', areaCode: AreaCode.SG })`, connects via `NCEngine.connect({ token })`, sends messages via `DirectChannel` + `SendTextMessageParams`, and receives live updates via `NCEngine.addMessageHandler`.

## Local Setup

```bash
git clone https://github.com/jayeshkhade9105-hub/linguadesk.git
cd linguadesk
npm install
npm run dev
```
