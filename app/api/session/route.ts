import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { DEMO_USERS } from '@/lib/demo-users';

export async function POST(req: Request) {
  const { userId } = await req.json();
  const valid = DEMO_USERS.some((u) => u.userId === userId);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid user' }, { status: 400 });
  }

  const cookieStore = await cookies();
  cookieStore.set('lingua_user', userId, { path: '/', httpOnly: true });
  return NextResponse.json({ ok: true, userId });
}

export async function GET() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('lingua_user')?.value || 'buyer_1';
  const user = DEMO_USERS.find((u) => u.userId === userId) || DEMO_USERS[0];
  return NextResponse.json({ user, allUsers: DEMO_USERS });
}
