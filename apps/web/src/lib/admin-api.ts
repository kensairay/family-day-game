export class AdminError extends Error {
 status: number;
 constructor(message: string, status: number) { super(message); this.status = status; }
}
// Only a logout notification crosses tabs; credentials and answers never enter storage.
let sessionEpoch = 0;
const invalidated = new Set<() => void>();
const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('family-admin-session');
function clearSession(notify = false) {
 sessionEpoch++; for (const clear of invalidated) clear();
 if (notify) {
  if (channel) channel.postMessage('logout');
  else { try { localStorage.setItem('family-admin-logout', crypto.randomUUID()); } catch { /* Storage may be disabled. */ } }
 }
}
if (channel) channel.onmessage = event => { if (event.data === 'logout') clearSession(); };
window.addEventListener('storage', event => { if (event.key === 'family-admin-logout') clearSession(); });
async function request<T>(path: string, method: string, data: unknown, decode: (response: Response) => Promise<T>): Promise<T> {
 const epoch = sessionEpoch;
 const response = await fetch(path, { method, credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
  ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
 if (epoch !== sessionEpoch) throw new AdminError('登入狀態已變更，請重新執行操作', 409);
 if (!response.ok) {
  const result = await response.json();
  if (epoch !== sessionEpoch) throw new AdminError('登入狀態已變更，請重新執行操作', 409);
  if (response.status === 401 && path !== '/api/admin/login') clearSession(true);
  throw new AdminError(result.error ?? '操作失敗', response.status);
 }
 const result = await decode(response);
 if (epoch !== sessionEpoch) throw new AdminError('登入狀態已變更，請重新執行操作', 409);
 return result;
}
export function adminRequest<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
 return request(path, method, data, response => response.json());
}
export function adminDownload(path: string): Promise<Blob> {
 return request(path, 'GET', undefined, response => response.blob());
}
export function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text = '') {
 const node = document.createElement(tag); node.textContent = text; parent.append(node); return node;
}
export function field(parent: HTMLElement, text: string, value: string, type = 'text') {
 const label = el(parent, 'label', text); const node = el(label, 'input'); node.type = type; node.value = value; return node;
}
export function select(parent: HTMLElement, text: string, values: [string, string][], value: string) {
 const label = el(parent, 'label', text); const node = el(label, 'select');
 node.setAttribute('aria-label', text);
 for (const [key, name] of values) { const option = el(node, 'option', name); option.value = key; }
 node.value = value; return node;
}
export function adminLogin(parent: HTMLElement, say: (text: string) => void, authenticated: () => Promise<void>, loggedOut: () => void, canLogout = () => true) {
 const box = el(parent, 'section'); box.className = 'admin-login';
 const title = el(box, 'h3', '管理員登入');
 const form = el(box, 'form'); const password = field(form, '管理密碼', '', 'password'); password.autocomplete = 'current-password'; password.required = true;
 const submit = el(form, 'button', '登入'); submit.type = 'submit';
 const note = el(box, 'p', '登入有效一小時；管理密碼不會存入瀏覽器儲存空間。'); note.className = 'muted';
 const logout = el(box, 'button', '登出後台'); logout.className = 'secondary'; logout.hidden = true;
 let busy = false, expiryTimer: ReturnType<typeof setTimeout> | undefined;
 const signedIn = async ({ expires }: { expires: number }) => {
  clearTimeout(expiryTimer);
  if (!Number.isFinite(expires) || expires <= Date.now()) { clearSession(); return; }
  expiryTimer = setTimeout(() => clearSession(true), Math.min(expires - Date.now(), 3600000));
  title.textContent = '管理員已登入'; form.hidden = true; note.hidden = true; logout.hidden = false; await authenticated();
 };
 const reauthenticate = () => { title.textContent = '請重新登入'; form.hidden = false; note.hidden = false; logout.hidden = true; password.value = ''; };
 invalidated.add(() => { clearTimeout(expiryTimer); loggedOut(); reauthenticate(); });
 form.onsubmit = async event => {
  event.preventDefault(); if (busy) return; busy = true; submit.disabled = true;
  try { const session = await adminRequest<{ expires: number }>('/api/admin/login', 'POST', { password: password.value }); password.value = ''; await signedIn(session); say('已登入管理後台。'); }
  catch (error) { say((error as Error).message); } finally { busy = false; submit.disabled = false; }
 };
 logout.onclick = async () => {
  if (!canLogout()) return;
  logout.disabled = true;
  try { await adminRequest('/api/admin/logout', 'POST', {}); clearSession(true); say('已登出，原登入憑證已撤銷。'); }
  catch (error) { say((error as Error).message); } finally { logout.disabled = false; }
 };
 void adminRequest<{ expires: number }>('/api/admin/session').then(signedIn).catch(error => { if (!(error instanceof AdminError && error.status === 401)) say(error.message); });
 return { reauthenticate: () => clearSession() };
}
