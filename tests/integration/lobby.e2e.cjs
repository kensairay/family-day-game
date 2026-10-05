const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=require('./target.cjs').testOrigin(process.env.TEST_URL||'http://127.0.0.1:8787');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH}:{})});
 const host=await browser.newContext();const p1=await browser.newContext();const p2=await browser.newContext();
 try {
  const h=await host.newPage();h.on('dialog',d=>d.accept());await h.goto(base+'/?host');
  await h.getByLabel('管理密碼').fill(process.env.TEST_ADMIN_SECRET||'local-test-only-very-long-secret');await h.getByRole('button',{name:'登入',exact:true}).click();
  let fixture;
  if(base.startsWith('https:')||process.env.TEST_USE_PUBLISHED_BANK==='true'){
   await h.getByRole('heading',{name:'管理員已登入',exact:true}).waitFor();
   fixture=await h.evaluate(async()=>{
    const call=async(path,data)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw new Error('測試題庫設定失敗');return r.json()};
    const questions=[1,2,3].map(round=>({id:'lobby-'+round,round,text:'大廳測試題'+round,options:['甲','乙'],correct:0,seconds:120,points:10}));
    const bank=await call('/api/admin/banks',{title:'E2E大廳-'+Date.now(),description:'自動驗收測試資料',questions});
    return call('/api/admin/banks/'+bank.id+'/publish',{revision:bank.revision});
   });
   await h.getByRole('button',{name:'重新載入已發布題庫',exact:true}).click();
   await h.getByLabel('使用題庫').locator('option').filter({hasText:fixture.title}).waitFor({state:'attached'});
  }
  await h.getByLabel('使用題庫').selectOption(fixture?fixture.id:'demo');await h.getByRole('button',{name:'建立房間'}).click();
  await h.getByText('目前 0 人在線／0 人已加入').waitFor();
  const link=await h.getByRole('link',{name:'開啟玩家加入頁'}).getAttribute('href');
  const a=await p1.newPage();await a.goto(link);await a.getByLabel('你的暱稱').fill('玩家一');await a.getByRole('button',{name:'加入遊戲'}).click();
  await h.getByText('目前 1 人在線／1 人已加入').waitFor();
  const b=await p2.newPage();await b.goto(link);await b.getByLabel('你的暱稱').fill('玩家二');await b.getByRole('button',{name:'加入遊戲'}).click();
  await h.getByText('目前 2 人在線／2 人已加入').waitFor();
  await a.reload();await a.locator('#name').filter({hasText:'玩家一'}).waitFor();await h.getByText('目前 2 人在線／2 人已加入').waitFor();
  const duplicate=await p1.newPage();await duplicate.goto(link);await a.getByText('此身分已在其他分頁連線，這個分頁已停止重連。').waitFor();
  await h.getByText('目前 2 人在線／2 人已加入').waitFor();
  await b.close();await h.getByText('目前 1 人在線／2 人已加入').waitFor();
  const result=await a.evaluate(async()=>{
   const r=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status;
  });assert.equal(result,401);
  await h.screenshot({path:'/tmp/family-lobby.png',fullPage:true});
  if(fixture){
   const roomCode=new URL(h.url()).searchParams.get('room');
   await h.getByRole('button',{name:'關閉房間並撤銷所有憑證',exact:true}).click();
   await h.getByRole('heading',{name:'房間已關閉',exact:true}).waitFor();
   await h.waitForFunction(async code=>{const response=await fetch('/api/admin/results/rooms/'+code+'/status');return response.ok&&(await response.json()).archive?.status==='complete'},roomCode,{timeout:30000,polling:1000});
   const archived=await h.evaluate(async bank=>(await fetch('/api/admin/banks/'+bank.id,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:bank.revision})})).status,fixture);
   assert.equal(archived,200);
  }
  console.log('PASS: 房間建立、兩人同步、重新整理恢復、同身分取代、離線人數及未授權拒絕');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
