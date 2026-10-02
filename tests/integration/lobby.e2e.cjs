const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const host=await browser.newContext();const p1=await browser.newContext();const p2=await browser.newContext();
 try {
  const h=await host.newPage();await h.goto('http://127.0.0.1:8787/?host');
  await h.getByLabel('管理密碼').fill('local-test-only-very-long-secret');await h.getByRole('button',{name:'建立房間'}).click();
  await h.getByText('目前 0 人在線／0 人已加入').waitFor();
  const link=await h.getByRole('link',{name:'開啟玩家加入頁'}).getAttribute('href');
  const a=await p1.newPage();await a.goto(link);await a.getByLabel('你的暱稱').fill('玩家一');await a.getByRole('button',{name:'加入遊戲'}).click();
  await h.getByText('目前 1 人在線／1 人已加入').waitFor();
  const b=await p2.newPage();await b.goto(link);await b.getByLabel('你的暱稱').fill('玩家二');await b.getByRole('button',{name:'加入遊戲'}).click();
  await h.getByText('目前 2 人在線／2 人已加入').waitFor();
  await a.reload();await a.getByText('玩家一',{exact:true}).waitFor();await h.getByText('目前 2 人在線／2 人已加入').waitFor();
  const duplicate=await p1.newPage();await duplicate.goto(link);await a.getByText('此身分已在其他分頁連線，這個分頁已停止重連。').waitFor();
  await h.getByText('目前 2 人在線／2 人已加入').waitFor();
  await b.close();await h.getByText('目前 1 人在線／2 人已加入').waitFor();
  const result=await h.evaluate(async()=>{
   const r=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status;
  });assert.equal(result,401);
  await h.screenshot({path:'/tmp/family-lobby.png',fullPage:true});
  console.log('PASS: 房間建立、兩人同步、重新整理恢復、同身分取代、離線人數及未授權拒絕');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
