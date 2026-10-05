const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = require('./target.cjs').testOrigin(process.env.TEST_URL || 'http://127.0.0.1:8787');
const remote = base.startsWith('https:');
const secret = process.env.TEST_ADMIN_SECRET || 'local-test-only-very-long-secret';
(async () => {
 const browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER_PATH ? { executablePath: process.env.TEST_BROWSER_PATH } : {}) });
 const context = await browser.newContext(); const page = await context.newPage();
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 page.on('dialog', d => d.accept());
 const title = 'E2E題庫-' + Date.now();
 try {
  // Exercise slow initial session lookup: login must wait for this probe.
  let initialSession = true;
  await page.route('**/api/admin/session', async route => {
   if (initialSession) { initialSession = false; await new Promise(resolve => setTimeout(resolve, 400)); }
   await route.continue();
  });
  await page.goto(base + '/?admin');
  await page.getByLabel('管理密碼').fill(secret);
  const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  assert.equal((await loginResponse).status(), 200, '管理員登入應成功');
  await page.getByRole('button', { name: '新增題庫', exact: true }).click();
  if (remote) {
   const cookie = (await context.cookies(base + '/api/admin/session')).find(item => item.name === 'family_admin');
   assert.ok(cookie && cookie.secure && cookie.httpOnly && cookie.sameSite === 'Strict');
   await page.getByText('HTTPS 測試環境 · 人機驗證為測試模式 · 請使用測試題與測試暱稱', { exact: true }).waitFor();
  }
  await page.getByLabel('題庫名稱', { exact: true }).fill(title);
  for (let i = 0; i < 3; i++) {
   await page.getByRole('button', { name: '新增題目', exact: true }).click();
   const q = page.locator('.question-editor').nth(i);
   await q.getByLabel('回合', { exact: true }).selectOption(String(i + 1));
   await q.getByLabel('題目', { exact: true }).fill('<script>window.injection = true</script> 第' + (i + 1) + '題');
   await q.getByLabel('選項A', { exact: true }).fill('答案A'); await q.getByLabel('選項B', { exact: true }).fill('答案B');
   await q.getByLabel('正確答案', { exact: true }).selectOption('1');
   if (remote) await q.getByLabel('作答秒數（3～120）', { exact: true }).fill('120');
  }
  // Preview the unsaved draft, including literal HTML, without publishing/saving it.
  await page.getByRole('button', { name: '題庫手機預覽', exact: true }).click();
  const preview = page.getByRole('dialog');
  await preview.getByRole('heading', { name: '題庫手機預覽', exact: true }).waitFor();
  for (const width of [320, 375, 430]) {
   await preview.getByLabel('手機寬度').selectOption(String(width));
   assert.equal(await preview.locator('.preview-screen').evaluate(node => Math.round(node.getBoundingClientRect().width)), width);
   assert.equal(await preview.locator('.preview-screen').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  }
  assert.equal(await preview.locator('.correct').count(), 0);
  await preview.getByRole('button', { name: 'B. 答案B', exact: true }).click();
  await preview.getByText('已選擇B（預覽，不會送出）', { exact: true }).waitFor();
  await preview.getByRole('button', { name: '模擬公布答案', exact: true }).click();
  await preview.getByText('正確答案：B. 答案B', { exact: true }).waitFor();
  await preview.getByRole('button', { name: '預覽下一題', exact: true }).click();
  assert.equal(await preview.locator('.correct').count(), 0);
  assert.equal(await page.evaluate(() => window.injection), undefined);
  await preview.screenshot({ path: '/tmp/family-question-preview.png' });
  await page.keyboard.press('Escape'); await preview.waitFor({ state: 'detached' });
  assert.equal(await page.getByLabel('題庫名稱', { exact: true }).inputValue(), title);
  assert.equal(await page.getByText('尚有未儲存變更', { exact: true }).count(), 1);
  await page.getByRole('button', { name: '儲存草稿', exact: true }).click();
  await page.getByText('草稿已儲存；已發布版本未變更。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '發布目前已儲存的草稿', exact: true }).click();
  await page.getByText('題庫已發布，可在主持人入口選用。', { exact: true }).waitFor();
  await page.reload();
  const row = page.locator('.bank-row').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await row.getByRole('button', { name: '編輯題庫', exact: true }).click();
  await page.locator('.question-editor').nth(2).waitFor();
  assert.equal(await page.locator('.question-editor').count(), 3);
  assert.equal(await page.locator('.question-editor').first().getByLabel('正確答案', { exact: true }).inputValue(), '1');
  assert.equal(await page.evaluate(() => window.injection), undefined);
  // A second tab changes the same revision: stale saves must preserve unsaved UI content.
  const other = await context.newPage(); other.on('dialog', d => d.accept()); await other.goto(base + '/?admin');
  await other.locator('.bank-row').filter({ has: other.getByRole('heading', { name: title, exact: true }) }).getByRole('button', { name: '編輯題庫' }).click();
  await other.getByLabel('題庫說明（選填）').fill('另一分頁的新修改');
  await other.getByRole('button', { name: '儲存草稿', exact: true }).click(); await other.getByText('草稿已儲存；已發布版本未變更。', { exact: true }).waitFor();
  await page.getByLabel('題庫說明（選填）').fill('本頁尚未儲存'); await page.getByRole('button', { name: '儲存草稿', exact: true }).click();
  await page.getByText('題庫已被其他分頁修改，請重新載入；目前內容未被覆蓋', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('題庫說明（選填）').inputValue(), '本頁尚未儲存');
  await page.getByRole('button', { name: '重新載入草稿', exact: true }).click(); await page.getByText('已載入最新版本。', { exact: true }).waitFor();
  const host = await context.newPage(); host.on('dialog', d => d.accept()); host.on('pageerror', e => errors.push(e.message)); await host.goto(base + '/?host');
  const bankId = await host.getByLabel('使用題庫').locator('option').filter({ hasText: title }).getAttribute('value');
  await host.getByLabel('使用題庫').selectOption(bankId); await host.getByRole('button', { name: '建立房間', exact: true }).click();
  await host.getByText('目前 0 人在線／0 人已加入', { exact: true }).waitFor();
  if (remote) {
   const code = new URL(host.url()).searchParams.get('room');
   for (const challenge of [undefined, 'invalid-staging-test-token']) {
    const rejected = await host.evaluate(async ({ code, challenge }) => (await fetch(`/api/rooms/${code}/join`, {
     method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: '拒絕測試', challenge }),
    })).status, { code, challenge });
    assert.equal(rejected, 403, '缺少／無效Turnstile token不可加入');
   }
  }
  const joinURL = await host.getByRole('link', { name: '開啟玩家加入頁', exact: true }).getAttribute('href');
  const playerContexts = await Promise.all([320, 430].map(width => browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true })));
  const players = await Promise.all(playerContexts.map(c => c.newPage()));
  for (let i = 0; i < players.length; i++) {
   players[i].on('pageerror', e => errors.push(e.message));
   await players[i].goto(joinURL); await players[i].getByLabel('你的暱稱').fill(`玩家${i + 1}`);
   await players[i].getByRole('button', { name: '加入遊戲', exact: true }).click();
  }
  await host.getByText('目前 2 人在線／2 人已加入', { exact: true }).waitFor();
  await players[0].reload(); await players[0].locator('#name').filter({ hasText: '玩家1' }).waitFor();
  await host.reload(); await host.getByText('目前 2 人在線／2 人已加入', { exact: true }).waitFor();
  for (let round = 0; round < 3; round++) {
   await host.getByRole('button', { name: round === 0 ? '開始第一回合' : '開始下一回合', exact: true }).click();
   await host.getByRole('heading', { name: `<script>window.injection = true</script> 第${round + 1}題`, exact: true }).waitFor();
   assert.equal(await host.evaluate(() => window.injection), undefined);
   for (let i = 0; i < players.length; i++) {
    const p = players[i]; await p.getByRole('heading', { name: '答題中', exact: true }).waitFor();
    assert.equal(await p.locator('#name').textContent(), `玩家${i + 1}｜已公布分數：${i === 0 ? round * 260 : 0} 分`);
    assert.equal(await p.locator('.correct').count(), 0);
    await p.getByRole('button', { name: i === 0 ? 'B　答案B' : 'A　答案A', exact: true }).click();
    await p.getByText('伺服器已收到你的答案', { exact: true }).waitFor();
    assert.equal(await p.locator('.answer:disabled').count(), 2);
    assert.equal(await p.locator('.correct').count(), 0);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
   }
   if (round === 0) {
    await players[0].reload(); await players[0].getByText('伺服器已收到你的答案', { exact: true }).waitFor();
    assert.equal(await players[0].locator('.answer:disabled').count(), 2);
   }
   await host.getByRole('button', { name: '提前收題', exact: true }).click();
   await players[0].getByRole('heading', { name: '答題時間結束，等待公布', exact: true }).waitFor();
   assert.equal(await players[0].locator('.correct').count(), 0);
   await host.getByRole('button', { name: '公布答案與分數', exact: true }).click();
   await players[0].getByText('這題獲得 260 分', { exact: true }).waitFor();
   await players[1].getByText('這題獲得 0 分', { exact: true }).waitFor();
   assert.equal(await players[0].locator('.correct').count(), 1);
   await host.getByRole('button', { name: '下一題／回合結算', exact: true }).click();
   await host.getByRole('heading', { name: round === 2 ? '遊戲完成' : '本回合結束', exact: true }).waitFor();
  }
  await host.getByText('成績已完整歸檔至 D1。', { exact: true }).waitFor();
  const roomId = new URL(host.url()).searchParams.get('room'); const results = await context.newPage(); results.on('pageerror', e => errors.push(e.message));
  await results.goto(base + '/?results');
  await results.locator('.bank-row').filter({ has: results.getByRole('heading', { name: `${title} · ${roomId}`, exact: true }) }).getByRole('button', { name: '查看成績', exact: true }).click();
  await results.getByRole('heading', { name: `${title}｜${roomId} 完整成績`, exact: true }).waitFor();
  assert.equal(await results.locator('.results-table tbody tr').count(), 2);
  const winner = results.locator('.results-table tbody tr').filter({ hasText: '玩家1' });
  assert.deepEqual(await winner.locator('td').allTextContents(), ['1', '玩家1', '780', '260', '260', '260', '3', '作答紀錄']);
  await winner.getByRole('button', { name: '作答紀錄', exact: true }).click();
  await results.getByRole('heading', { name: '玩家1 的作答紀錄', exact: true }).waitFor();
  assert.equal(await results.getByText('獲得260分', { exact: false }).count(), 3);
  const downloadEvent = results.waitForEvent('download'); await results.getByRole('button', { name: '匯出 CSV', exact: true }).click();
  assert.equal((await downloadEvent).suggestedFilename(), `results-${roomId}.csv`);
  await page.getByRole('button', { name: '封存題庫', exact: true }).click(); await page.getByText('題庫已封存。', { exact: true }).waitFor();
  // Another tab has a sensitive preview open when logout occurs.
  await other.getByRole('button', { name: '題庫手機預覽', exact: true }).click();
  await other.getByRole('dialog').waitFor();
  // A successful response already authorised before logout must not refill the DOM afterward.
  let release, intercepted;
  const gate = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { intercepted = resolve; });
  await results.route('**/api/admin/results?offset=0', async route => {
   const response = await route.fetch(); intercepted(); await gate; await route.fulfill({ response });
  });
  await results.getByRole('button', { name: '重新載入成績清單', exact: true }).click(); await reached;
  await page.getByRole('button', { name: '登出後台', exact: true }).click(); await page.getByText('已登出，原登入憑證已撤銷。', { exact: true }).waitFor();
  await other.getByRole('dialog').waitFor({ state: 'detached' });
  await other.getByRole('heading', { name: '請重新登入', exact: true }).waitFor();
  assert.equal(await other.locator('.question-editor').count(), 0);
  await results.getByRole('heading', { name: '請重新登入', exact: true }).waitFor();
  assert.equal(await results.locator('.results-table').count(), 0);
  release(); await results.getByText('登入狀態已變更，請重新執行操作', { exact: true }).waitFor();
  assert.equal(await results.locator('.bank-row').count(), 0);
  assert.equal(await page.evaluate(async () => (await fetch('/api/admin/banks')).status), 401);
  // Idle session expiry must clear drafts and an open preview even without an API action.
  await page.clock.install();
  await page.getByLabel('管理密碼').fill(secret); await page.getByRole('button', { name: '登入', exact: true }).click();
  await page.getByRole('button', { name: '新增題庫', exact: true }).click();
  await page.getByRole('button', { name: '題庫手機預覽', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.clock.fastForward(3600001);
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: '請重新登入', exact: true }).waitFor();
  assert.equal(await page.getByLabel('題庫名稱', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: 草稿手機預覽320/375/430、XSS、儲存發布、版本衝突、兩位手機玩家三回合、重載恢復、公布前保密、D1排名/作答明細/CSV、封存、跨分頁登出、遲到回應攔截、閒置到期清除');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
