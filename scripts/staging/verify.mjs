import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const { testOrigin } = createRequire(import.meta.url)('../../tests/integration/target.cjs');
const target = JSON.parse(await readFile('staging-target.generated.json', 'utf8'));
const origin = testOrigin(target.origin);
if (!origin.startsWith('https:')) throw new Error('遠端驗收需要HTTPS');
const secret = process.env.STAGING_ADMIN_SECRET;
if (!secret || secret.length < 24) throw new Error('缺少Staging管理密碼');
const results = []; const report = { origin, revision: target.revision, startedAt: new Date().toISOString(), results, status: 'running' };
const clean = text => String(text ?? '').replaceAll(secret, '[redacted]');
async function check(name, fn) { await fn(); results.push({ name, status: 'passed' }); console.log('PASS: ' + name); }
async function request(path, options = {}) { return fetch(origin + path, { ...options, signal: AbortSignal.timeout(15000) }); }
function expect(value, message) { if (!value) throw new Error(message); }
try {
 await check('HTTPS／Staging模式／部署版本就緒', async () => {
  const deadline = Date.now() + 90000; let ready = false;
  while (Date.now() < deadline) {
   try {
    const response = await request('/api/config'); const config = await response.json();
    ready = response.ok && config.environment === 'staging' && config.turnstileMode === 'test' && config.turnstileSiteKey === '1x00000000000000000000AA' && config.deploymentRevision === target.revision;
    if (ready) break;
   } catch { /* Deployment propagation may take a moment. */ }
   await new Promise(resolve => setTimeout(resolve, 2000));
  }
  expect(ready, 'HTTPS測試部署尚未就緒或版本不符');
 });
 await check('網頁CSP／nosniff與HTTP拒絕或HTTPS轉址', async () => {
  const response = await request('/'); expect(response.ok, '網頁讀取失敗');
  const csp = response.headers.get('Content-Security-Policy');
  expect(csp?.includes("frame-ancestors 'none'"), '缺少CSP');
  expect(csp?.includes(`connect-src 'self' ${origin.replace('https:', 'wss:')};`), '未明確允許本站WebSocket');
  expect(response.headers.get('X-Content-Type-Options') === 'nosniff', '缺少nosniff');
  const insecure = await fetch(origin.replace('https:', 'http:') + '/api/config', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  if (insecure.status !== 403) {
   expect([301, 302, 307, 308].includes(insecure.status), 'HTTP未拒絕或轉址');
   const location = insecure.headers.get('Location'); expect(!!location, 'HTTP轉址缺少Location');
   const destination = new URL(location, origin);
   expect(destination.protocol === 'https:' && destination.hostname === new URL(origin).hostname, 'HTTPS轉址目標不符');
  }
 });
 await check('未登入管理API拒絕／跨來源修改拒絕／未知房間拒絕', async () => {
  for (const path of ['/api/admin/banks', '/api/admin/results', '/api/admin/session', '/api/admin/results/00000000-0000-4000-8000-000000000000/csv']) {
   const response = await request(path); expect(response.status === 401, '未登入應拒絕：' + path);
   expect(response.headers.get('Cache-Control') === 'no-store', '敏感API缺少no-store');
  }
  const forbidden = await request('/api/rooms', { method: 'POST', headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json' }, body: '{}' });
  expect(forbidden.status === 403, '跨來源修改未拒絕');
  const unknown = await request('/api/rooms/ABCDEFG2/join', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: '未知測試' }) });
  expect(unknown.status === 404, '未知房間未拒絕');
 });
 // Do not pass the Cloudflare deployment token into browser tests.
 const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('CLOUDFLARE_') && !['STAGING_ADMIN_SECRET', 'GH_TOKEN', 'GITHUB_TOKEN'].includes(name)));
 env.TEST_URL = origin; env.TEST_ADMIN_SECRET = secret;
 for (const script of ['admin.e2e.cjs', 'lobby.e2e.cjs', 'connection.e2e.cjs']) await check(script === 'admin.e2e.cjs' ? '遠端題庫／三回合／正解保密／D1成績／CSV／工作階段驗收' : script === 'lobby.e2e.cjs' ? '遠端大廳同步／分頁取代／斷線恢復驗收' : 'Chromium／WebKit六題題庫連線與錯誤提示驗收', async () => {
  const output = await promisify(execFile)(process.execPath, ['tests/integration/' + script], { env, timeout: 180000, maxBuffer: 1024 * 1024 });
  process.stdout.write(clean(output.stdout));
 });
 report.status = 'passed';
} catch (error) {
 report.status = 'failed'; report.error = clean(error.stderr || error.message); console.error(report.error); process.exitCode = 1;
} finally {
 report.finishedAt = new Date().toISOString(); await writeFile('staging-acceptance.generated.json', JSON.stringify(report, null, 2) + '\n');
 if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n## 遠端HTTPS驗收：${report.status === 'passed' ? '通過' : '失敗'}\n\n${results.map(item => '- 通過：' + item.name).join('\n')}\n\n這是桌面Chromium／WebKit（含模擬手機尺寸）；真實手機、真實Turnstile與350連線壓測仍待驗收。\n`);
}
