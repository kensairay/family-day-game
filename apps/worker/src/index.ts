import type { GameRoom } from './room/GameRoom.ts';
import type { RoomDirectory } from './RoomDirectory.ts';
import { sampleQuestions, validateQuestions } from './room/engine.ts';
import { credential, digest, failure, HttpError, json, readJSON } from './security.ts';
import { nickname, validRoom } from '../../../packages/shared/src/protocol.ts';
import { adminGate, authorizeAdmin, sessionRoute } from './admin/auth.ts';
import { bankRoute, publishedBankSnapshot } from './admin/banks.ts';
import type { BankSource } from '../../../packages/shared/src/results.ts';
import { resultsRoute } from './admin/results.ts';
import { turnstileMode, verifyTurnstile } from './turnstile.ts';
export { GameRoom } from './room/GameRoom.ts';
export { RoomDirectory } from './RoomDirectory.ts';
export interface Env {
 ROOMS: DurableObjectNamespace<GameRoom>; DIRECTORY: DurableObjectNamespace<RoomDirectory>; ASSETS: Fetcher;
 ADMIN_SECRET?: string; PUBLIC_DEPLOYMENT?: string; TURNSTILE_SECRET?: string; TURNSTILE_SITE_KEY?: string;
 DEPLOYMENT_ENV?: string; TURNSTILE_MODE?: string; STAGING_HOSTNAME?: string; DEPLOYMENT_REVISION?: string;
 DB?: D1Database;
}
export default {
 async fetch(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && url.protocol !== 'https:') return json({ error: '需要HTTPS連線' }, 403);
  if (!url.pathname.startsWith('/api/')) {
   const asset = await env.ASSETS.fetch(req); const headers = new Headers(asset.headers);
   // Explicitly allow only this site's WebSocket origin. Some browsers do not
   // include ws/wss in connect-src 'self'. Keep the port for local development.
   const socketOrigin = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
   headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; connect-src 'self' ${socketOrigin}; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
   headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Referrer-Policy', 'no-referrer');
   return new Response(asset.body, { status: asset.status, headers });
  }
  try {
   if (!local && (env.PUBLIC_DEPLOYMENT !== 'true' || !env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY)) throw new HttpError(503, '公開部署尚未完成安全設定');
   const mode = local ? 'off' : turnstileMode(env, url.hostname);
   if (!['GET', 'HEAD'].includes(req.method) || url.pathname.endsWith('/socket')) {
    if (req.headers.get('Origin') !== url.origin) throw new HttpError(403, '來源驗證失敗');
   }
   if (url.pathname === '/api/config' && req.method === 'GET') return json({ turnstileSiteKey: local ? null : env.TURNSTILE_SITE_KEY, environment: env.DEPLOYMENT_ENV ?? (local ? 'local' : 'production'), turnstileMode: mode, deploymentRevision: env.DEPLOYMENT_REVISION ?? null });
   if (['/api/admin/login', '/api/admin/logout', '/api/admin/session'].includes(url.pathname)) return await sessionRoute(req, env, local);
   if (url.pathname.startsWith('/api/admin/')) {
    await adminGate(req, env, 'admin'); await authorizeAdmin(req, env);
    if (url.pathname === '/api/admin/results' || url.pathname.startsWith('/api/admin/results/')) return await resultsRoute(req, env);
    return await bankRoute(req, env.DB);
   }
   const ipHash = await digest(req.headers.get('CF-Connecting-IP') ?? 'local');
   const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory-v1'));
   const gate = async (kind: 'create' | 'join' | 'socket', room?: string) => {
    const status = await directory.gate(ipHash, kind, room);
    if (status !== 200) throw new HttpError(status, status === 429 ? '操作太頻繁，請稍後再試' : '房間不存在或已到期');
   };
   if (url.pathname === '/api/rooms' && req.method === 'POST') {
    await gate('create');
    await authorizeAdmin(req, env, true);
    const data = await readJSON(req);
    let questions;
    let source: BankSource = { bankId: null, revision: null, title: '本機示範／自訂題庫' };
    if (data.bankId !== undefined) {
     if (data.questions !== undefined) throw new HttpError(400, '不可同時指定題庫與自訂題目');
     const bank = await publishedBankSnapshot(env.DB, data.bankId, data.publishedRevision); questions = bank.questions; source = bank.source;
    } else {
     if (!local) throw new HttpError(400, '正式環境須選擇已發布題庫');
     try { questions = validateQuestions(data.questions ?? sampleQuestions); } catch (e) { throw new HttpError(400, (e as Error).message); }
    }
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const expires = Date.now() + 86400000;
    for (let attempt = 0; attempt < 5; attempt++) {
     const roomId = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => alphabet[b % 32]).join('');
     const hostToken = credential();
     if (!await directory.register(roomId, expires)) continue;
     const response = await env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(new Request('https://room/init', {
      method: 'POST', body: JSON.stringify({ id: roomId, hostHash: await digest(hostToken), expires, questions, source, createdAt: Date.now() }),
     }));
     if (!response.ok) return response;
     return json({ roomId, hostToken, expires }, 201);
    }
    throw new HttpError(503, '請稍後再建立房間');
   }
   const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/(join|socket|connection)$/);
   if (!match || !validRoom(match[1])) throw new HttpError(404, '找不到房間');
   const [, room, action] = match;
   if (action === 'connection') {
    if (req.method !== 'POST') throw new HttpError(405, '不支援的操作');
    await gate('socket', room);
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req);
   }
   if (action === 'join') {
    if (req.method !== 'POST') throw new HttpError(405, '不支援的操作');
    await gate('join', room);
    const data = await readJSON(req, 4096);
    let name;
    try { name = nickname(data.nickname); } catch (e) { throw new HttpError(400, (e as Error).message); }
    if (!local) await verifyTurnstile(env, url.hostname, data.challenge, req.headers.get('CF-Connecting-IP'));
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(new Request('https://room/join', {
     method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: name }),
    }));
   }
   if (req.method !== 'GET' || req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new HttpError(405, '需要WebSocket連線');
   await gate('socket', room);
   return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req);
  } catch (error) { return failure(error); }
 },
}
