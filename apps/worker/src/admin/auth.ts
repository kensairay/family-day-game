import type { Env } from '../index.ts';
import { credential, digest, HttpError, json, readJSON } from '../security.ts';

const cookieName = 'family_admin';
function secret(env: Env): string {
 if (!env.ADMIN_SECRET || env.ADMIN_SECRET.length < 24 || env.ADMIN_SECRET === 'replace-with-a-long-random-secret') throw new HttpError(503, '尚未設定有效的管理密碼');
 return env.ADMIN_SECRET;
}
function cookie(req: Request): string | undefined {
 return req.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
}
const directory = (env: Env) => env.DIRECTORY.get(env.DIRECTORY.idFromName('directory-v1'));
export async function adminGate(req: Request, env: Env, kind: 'login' | 'admin') {
 const status = await directory(env).gate(await digest(req.headers.get('CF-Connecting-IP') ?? 'local'), kind);
 if (status !== 200) throw new HttpError(status, '操作太頻繁，請稍後再試');
}
export async function authorizeAdmin(req: Request, env: Env, allowBearer = false) {
 const key = secret(env);
 if (allowBearer && req.headers.get('Authorization') === `Bearer ${key}`) return;
 const token = cookie(req);
 if (token && /^[a-f0-9-]{72}$/.test(token) && await directory(env).adminSessionValid(await digest(token), await digest(key))) return;
 throw new HttpError(401, '請先登入管理後台');
}
export async function sessionRoute(req: Request, env: Env, local: boolean): Promise<Response> {
 const name = new URL(req.url).pathname;
 if (name === '/api/admin/login' && req.method === 'POST') {
  await adminGate(req, env, 'login');
  const data = await readJSON(req, 4096); const key = secret(env);
  if (typeof data.password !== 'string' || await digest(data.password) !== await digest(key)) throw new HttpError(401, '管理密碼錯誤');
  const token = credential(); const expires = Date.now() + 3600000;
  await directory(env).adminSessionCreate(await digest(token), expires, await digest(key));
  const previous = cookie(req);
  if (previous && previous.length <= 100) await directory(env).adminSessionRevoke(await digest(previous));
  const response = json({ expires });
  response.headers.set('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api/; Max-Age=3600${local ? '' : '; Secure'}`);
  return response;
 }
 if (name === '/api/admin/logout' && req.method === 'POST') {
  await adminGate(req, env, 'admin');
  const token = cookie(req);
  if (token && token.length <= 100) await directory(env).adminSessionRevoke(await digest(token));
  const response = json({ ok: true });
  response.headers.set('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/api/; Max-Age=0${local ? '' : '; Secure'}`);
  return response;
 }
 if (name === '/api/admin/session' && req.method === 'GET') {
  await adminGate(req, env, 'admin'); await authorizeAdmin(req, env); return json({ authenticated: true });
 }
 throw new HttpError(405, '不支援的操作');
}
