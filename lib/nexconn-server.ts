import 'server-only';
import crypto from 'crypto';
import { DEMO_USERS } from './demo-users';

const CANDIDATE_HOSTS = [
  'https://api.sg-light-api.com',
  'https://api2-sg-light-api.com',
  'https://api-sg01.nexconn.ai',
  'https://api.sg.nexconn.ai',
];

export async function issueChatToken(userId: string): Promise<string> {
  const appKey = process.env.NEXT_PUBLIC_NEXCONN_APP_KEY?.trim();
  const appSecret = process.env.NEXCONN_APP_SECRET?.trim();

  if (!appKey || !appSecret || appSecret === 'paste_your_app_secret_here') {
    throw new Error('NEXCONN_APP_SECRET is missing or still set to placeholder in .env.local');
  }

  const user = DEMO_USERS.find((u) => u.userId === userId);
  if (!user) {
    throw new Error(`Unknown demo user: ${userId}`);
  }

  let lastError = 'Unknown network error';

  for (const host of CANDIDATE_HOSTS) {
    try {
      const nonce = Math.floor(Math.random() * 1_000_000_000).toString();
      const timestamp = Date.now().toString();
      const signature = crypto
        .createHash('sha1')
        .update(`${appSecret}${nonce}${timestamp}`)
        .digest('hex');

      const body = new URLSearchParams({
        userId: user.userId,
        name: user.name,
        portraitUri: user.avatar,
      });

      const res = await fetch(`${host}/user/getToken.json`, {
        method: 'POST',
        headers: {
          'App-Key': appKey,
          Nonce: nonce,
          Timestamp: timestamp,
          Signature: signature,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        cache: 'no-store',
      });

      const data = await res.json();
      if (res.ok && data.code === 200 && data.token) {
        return data.token;
      }
      lastError = `${host} returned HTTP ${res.status}: ${JSON.stringify(data)}`;
    } catch (err: unknown) {
      const cause = err instanceof Error && 'cause' in err ? String((err as { cause?: unknown }).cause) : '';
      const msg = err instanceof Error ? err.message : String(err);
      lastError = `${host} -> ${msg} ${cause}`.trim();
    }
  }

  throw new Error(lastError);
}