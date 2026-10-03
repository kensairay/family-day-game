const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
const secret = process.env.TEST_ADMIN_SECRET || 'local-test-only-very-long-secret';
(async () => {
 const browser = await chromium.launch({ headless: true });
 const context = await browser.newContext(); const page = await context.newPage();
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 page.on('dialog', d => d.accept());
 const title = 'E2E題庫-' + Date.now();
 try {
  await page.goto(base + '/?admin');
  await page.getByLabel('管理密碼').fill(secret); await page.getByRole('button', { name: '登入', exact: true }).click();
  await page.getByRole('button', { name: '新增題庫', exact: true }).click();
  await page.getByLabel('題庫名稱', { exact: true }).fill(title);
  for (let i = 0; i < 3; i++) {
   await page.getByRole('button', { name: '新增題目', exact: true }).click();
   const q = page.locator('.question-editor').nth(i);
   await q.getByLabel('回合', { exact: true }).selectOption(String(i + 1));
   await q.getByLabel('題目', { exact: true }).fill('<script>window.injection = true</script> 第' + (i + 1) + '題');
   await q.getByLabel('選項A', { exact: true }).fill('答案A'); await q.getByLabel('選項B', { exact: true }).fill('答案B');
   await q.getByLabel('正確答案', { exact: true }).selectOption('1');
  }
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
  const host = await context.newPage(); await host.goto(base + '/?host');
  const bankId = await host.getByLabel('使用題庫').locator('option').filter({ hasText: title }).getAttribute('value');
  await host.getByLabel('使用題庫').selectOption(bankId); await host.getByRole('button', { name: '建立房間', exact: true }).click();
  await host.getByText('目前 0 人在線／0 人已加入', { exact: true }).waitFor();
  await host.getByRole('button', { name: '開始第一回合', exact: true }).click();
  await host.getByRole('heading', { name: '<script>window.injection = true</script> 第1題', exact: true }).waitFor();
  assert.equal(await host.evaluate(() => window.injection), undefined);
  await page.getByRole('button', { name: '封存題庫', exact: true }).click(); await page.getByText('題庫已封存。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '登出後台', exact: true }).click(); await page.getByText('已登出，原登入憑證已撤銷。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => (await fetch('/api/admin/banks')).status), 401);
  assert.deepEqual(errors, []);
  console.log('PASS: 題庫輸入、儲存／發布、重新載入、答案設定、多分頁衝突、XSS字串、主持人選題庫、封存、登出');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
