import { NextRequest, NextResponse } from 'next/server';
import { issueChatToken } from '@/lib/nexconn-server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = body.userId || req.cookies.get('linguadesk_uid')?.value || 'buyer_1';
    const token = await issueChatToken(userId);
    return NextResponse.json({ token, userId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}