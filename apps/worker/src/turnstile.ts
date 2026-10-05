import type { Env } from './index.ts';
import { HttpError } from './security.ts';

// Cloudflare's documented dummy pair, confined to the dedicated synthetic staging Worker.
export const testSiteKey = '1x00000000000000000000AA';
export const testSecretKey = '1x0000000000000000000000000000000AA';
const testSites = new Set([testSiteKey, '2x00000000000000000000AB', '1x00000000000000000000BB', '2x00000000000000000000BB', '3x00000000000000000000FF']);
const testSecrets = new Set([testSecretKey, '2x0000000000000000000000000000000AA', '3x0000000000000000000000000000000AA']);
type Settings = Pick<Env, 'DEPLOYMENT_ENV' | 'STAGING_HOSTNAME' | 'TURNSTILE_MODE' | 'TURNSTILE_SITE_KEY' | 'TURNSTILE_SECRET'>;
export function turnstileMode(env: Settings, hostname: string): 'real' | 'test' {
 if (env.TURNSTILE_MODE === 'test') {
  if (env.DEPLOYMENT_ENV !== 'staging' || env.STAGING_HOSTNAME !== hostname || !/^family-day-game-staging\.[a-z0-9-]+\.workers\.dev$/.test(hostname)
   || env.TURNSTILE_SITE_KEY !== testSiteKey || env.TURNSTILE_SECRET !== testSecretKey) throw new HttpError(503, '測試環境安全設定不符');
  return 'test';
 }
 if ((env.TURNSTILE_MODE && env.TURNSTILE_MODE !== 'real') || testSites.has(env.TURNSTILE_SITE_KEY ?? '') || testSecrets.has(env.TURNSTILE_SECRET ?? '')) throw new HttpError(503, '正式驗證不可使用測試金鑰');
 return 'real';
}
export async function verifyTurnstile(env: Settings, hostname: string, challenge: unknown, remoteip: string | null, fetcher: typeof fetch = fetch) {
 const mode = turnstileMode(env, hostname);
 if (typeof challenge !== 'string' || !challenge || challenge.length > 2048) throw new HttpError(403, '請完成人機驗證');
 const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: challenge, remoteip }), signal: AbortSignal.timeout(5000),
 });
 const check = await response.json() as { success?: boolean; hostname?: string; action?: string };
 // Dummy verification has fixed metadata. Real widgets must still match hostname and action.
 if (!response.ok || check.success !== true || (mode === 'real' && (check.hostname !== hostname || check.action !== 'join'))) throw new HttpError(403, '人機驗證失敗，請重試');
}
