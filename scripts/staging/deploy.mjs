import { readFile, writeFile, appendFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { stagingTemplate } from './config.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const admin = process.env.STAGING_ADMIN_SECRET;
const worker = 'family-day-game-staging';
const database = 'family-day-game-staging';
const generated = 'wrangler.staging.generated.json';
if (!account || !/^[a-f0-9]{32}$/i.test(account) || !token || !admin || admin.length < 24 || admin === 'replace-with-a-long-random-secret') throw new Error('缺少有效部署連線。請先設定 GitHub Actions 的三項 secrets。');
const config = stagingTemplate(JSON.parse(await readFile('wrangler.staging.json', 'utf8')));

async function api(path, method = 'GET', body) {
 const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
  method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
 });
 let data; try { data = await response.json(); } catch { throw new Error(`Cloudflare API ${method} ${path.split('?')[0]} 未回傳JSON（HTTP ${response.status}）`); }
 if (!response.ok || data.success !== true) throw new Error(`Cloudflare API ${method} ${path.split('?')[0]} 失敗（HTTP ${response.status}）；請檢查帳號權限與配額。`);
 return data.result;
}
function wrangler(args) {
 return new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args, '--config', generated], {
   stdio: 'inherit', env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Wrangler ${args[0]} 失敗（exit ${code}）`)));
 });
}
// Read account settings only. Choosing/changing the account's workers.dev subdomain is a user action.
const subdomain = (await api('workers/subdomain'))?.subdomain;
if (typeof subdomain !== 'string' || !/^[a-z0-9-]+$/.test(subdomain)) throw new Error('請先在 Cloudflare Workers & Pages 完成 workers.dev 子網域設定。');
const hostname = `${worker}.${subdomain}.workers.dev`;
let databases = await api(`d1/database?name=${database}&per_page=100`);
if (!Array.isArray(databases)) throw new Error('D1清單格式不符');
let db = databases.find(item => item.name === database);
if (!db) db = await api('d1/database', 'POST', { name: database });
if (db.name !== database || !/^[a-f0-9-]{36}$/i.test(db.uuid)) throw new Error('D1部署目標驗證失敗');
config.account_id = account; config.d1_databases[0].database_id = db.uuid;
config.vars.STAGING_HOSTNAME = hostname; config.vars.DEPLOYMENT_REVISION = process.env.GITHUB_SHA ?? 'manual-staging';
await writeFile(generated, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
await wrangler(['d1', 'migrations', 'apply', database, '--remote']);
// Upload code and the private secret in one deployment. Delete the temporary secret file afterward.
const secretDir = await mkdtemp(join(tmpdir(), 'family-staging-secret-'));
try {
 const secretFile = join(secretDir, 'secrets.json');
 await writeFile(secretFile, JSON.stringify({ ADMIN_SECRET: admin }), { mode: 0o600 });
 await wrangler(['deploy', '--secrets-file', secretFile]);
} finally { await rm(secretDir, { recursive: true, force: true }); }
const origin = 'https://' + hostname;
await writeFile('staging-target.generated.json', JSON.stringify({ origin, revision: config.vars.DEPLOYMENT_REVISION }) + '\n', { mode: 0o600 });
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `origin=${origin}\n`);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n已部署 Staging：[測試網址](${origin})。接續自動驗收；此時尚不代表驗收通過。\n`);
console.log(`Staging部署完成：${origin}；接續遠端驗收。`);
