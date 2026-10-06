const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const base = require('./target.cjs').testOrigin(process.env.TEST_URL || 'http://127.0.0.1:8787');
const secret = process.env.TEST_ADMIN_SECRET || 'local-test-only-very-long-secret';
const examples = [
 ['一個星期有幾天？',['7天','8天'],0], ['一小時有幾分鐘？',['100分鐘','60分鐘'],1],
 ['哪一種是哺乳類？',['海豚','鯊魚'],0], ['企鵝能不能飛？',['能飛','不能飛'],1],
 ['地球繞著什麼運行？',['月球','太陽'],1], ['水結冰後，體積如何變化？',['變大','變小'],0],
];
(async () => {
 for (const [name, engine] of [['chromium',chromium],['webkit',webkit]]) {
  const browser = await engine.launch({ headless:true, ...(name==='chromium' && process.env.TEST_BROWSER_PATH ? { executablePath:process.env.TEST_BROWSER_PATH } : {}) });
  const context = await browser.newContext(); const page = await context.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',d=>d.accept());
  let bank, revision;
  const api = async (path, data, method='POST') => {
   const response = await context.request.fetch(base+path,{ method, headers:{Origin:base}, ...(data===undefined?{}:{data}) });
   assert.equal(response.ok(),true,`${name}: ${path} HTTP ${response.status()}`); return response.json();
  };
  try {
   await api('/api/admin/login',{password:secret});
   const title=`連線回歸測試-${name}-${Date.now()}`;
   const questions=examples.map(([text,options,correct],i)=>({id:`trial-${i+1}`,round:Math.floor(i/2)+1,text,options,correct,seconds:20,points:100}));
   bank=await api('/api/admin/banks',{title,description:'六題、三回合的自動連線回歸測試',questions}); revision=bank.revision;
   const published=await api(`/api/admin/banks/${bank.id}/publish`,{revision}); revision=published.revision;
   await page.goto(base+'/?host');
   await page.getByLabel('使用題庫').selectOption(bank.id); await page.getByRole('button',{name:'建立房間',exact:true}).click();
   await page.getByRole('button',{name:'開始第一回合',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'開始第一回合',exact:true}).isEnabled(),true);
   const room=new URL(page.url()).searchParams.get('room');
   // The status backend must work without a host credential in this tab,
   // and observing a room must not replace the original host WebSocket.
   const rooms=await context.newPage(); rooms.on('pageerror',e=>errors.push(e.message));
   await rooms.goto(base+'/?rooms');
   await rooms.locator(`.room-row[data-room="${room}"]`).getByRole('button',{name:'查看房間狀態',exact:true}).click();
   const detail=rooms.locator('.room-detail');
   const fact=label=>detail.locator('dt').filter({hasText:label}).evaluate(node=>node.nextElementSibling.textContent);
   await detail.getByRole('heading',{name:`房間 ${room} 詳細狀態`,exact:true}).waitFor();
   assert.equal(await fact('主持人連線'),'在線'); assert.equal(await fact('遊戲階段'),'等待開始');
   assert.equal(await rooms.evaluate(()=>sessionStorage.length),0,'查看頁面不需要主持人憑證');
   assert.equal(await page.getByRole('button',{name:'開始第一回合',exact:true}).isEnabled(),true);
   const playerContext=await browser.newContext({viewport:{width:375,height:800}});
   const player=await playerContext.newPage(); player.on('pageerror',e=>errors.push(e.message));
   await player.goto(base+'/?room='+room); await player.getByLabel('你的暱稱').fill('連線試玩');
   await player.getByRole('button',{name:'加入遊戲',exact:true}).click();
   await page.getByText('目前 1 人在線／1 人已加入',{exact:true}).waitFor();
   assert.equal((await playerContext.request.get(base+'/api/admin/rooms')).status(),401,'玩家不可讀取後台房間清單');
   await detail.getByRole('button',{name:'重新整理此房間',exact:true}).click();
   await detail.getByText('1 人在線／1 人已加入',{exact:true}).waitFor();
   await page.reload(); await page.getByText('目前 1 人在線／1 人已加入',{exact:true}).waitFor();
   for(let i=0;i<questions.length;i++) {
    if(i%2===0) await page.getByRole('button',{name:i===0?'開始第一回合':'開始下一回合',exact:true}).click();
    const q=questions[i];
    await page.getByRole('heading',{name:q.text,exact:true}).waitFor();
    if(i===0) {
     await detail.getByRole('button',{name:'重新整理此房間',exact:true}).click();
     await detail.getByText('答題中',{exact:true}).waitFor();
     assert.equal(await fact('題目進度'),'第1回合 · 第1／6題');
     assert.equal(await page.getByText('此身分已在其他分頁連線，這個分頁已停止重連。',{exact:true}).count(),0);
    }
    await player.getByRole('heading',{name:q.text,exact:true}).waitFor();
    await player.getByRole('button',{name:`${String.fromCharCode(65+q.correct)}　${q.options[q.correct]}`,exact:true}).click();
    await player.getByText('伺服器已收到你的答案',{exact:true}).waitFor();
    await page.getByRole('button',{name:'提前收題',exact:true}).click();
    await page.getByRole('button',{name:'公布答案與分數',exact:true}).click();
    await player.getByText('這題獲得 100 分',{exact:true}).waitFor();
    await page.getByRole('button',{name:'下一題／回合結算',exact:true}).click();
   }
   await page.getByRole('heading',{name:'遊戲完成',exact:true}).waitFor();
   await player.locator('#name').filter({hasText:'連線試玩｜已公布分數：600 分'}).waitFor();
   await page.getByText('成績已完整歸檔至 D1。',{exact:true}).waitFor();
   await detail.getByRole('button',{name:'重新整理此房間',exact:true}).click();
   await detail.getByText('已完整歸檔',{exact:true}).waitFor(); assert.equal(await fact('房間狀態'),'已完成');
   await rooms.setViewportSize({width:375,height:800});
   assert.equal(await rooms.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'房間頁面375px不可水平溢出');
   await rooms.screenshot({path:`/tmp/family-room-status-${name}.png`,fullPage:true});
   await playerContext.close();
   // Simulate a blocked WebSocket and an expired room. The initial loading
   // text must become an actionable reason, without enabling host commands.
   await page.routeWebSocket('**/socket',ws=>ws.close());
   await page.route('**/connection',route=>route.fulfill({status:410,contentType:'application/json',body:'{"error":"房間已關閉或到期"}'}));
   await page.reload();
   await page.locator('.card').getByText('房間已關閉或到期，請從主持人入口建立新房間。',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'開始第一回合',exact:true}).count(),0);
   await detail.getByRole('button',{name:'重新整理此房間',exact:true}).click();
   await detail.getByText('離線',{exact:true}).waitFor();
   // Clean up this test's bank before logout; no extra login is needed and
   // unrelated user-created banks/rooms are never altered.
   await api(`/api/admin/banks/${bank.id}`,{revision},'DELETE'); bank=undefined;
   const otherRooms=await context.newPage(); await otherRooms.goto(base+'/?rooms');
   await otherRooms.getByText('清單更新：',{exact:false}).waitFor();
   let release,reached;
   const gate=new Promise(resolve=>{release=resolve}), intercepted=new Promise(resolve=>{reached=resolve});
   await rooms.route(`**/api/admin/rooms/${room}`,async route=>{const response=await route.fetch();reached();await gate;await route.fulfill({response});});
   await detail.getByRole('button',{name:'重新整理此房間',exact:true}).click(); await intercepted;
   await otherRooms.getByRole('button',{name:'登出後台',exact:true}).click();
   await rooms.getByRole('heading',{name:'請重新登入',exact:true}).waitFor();
   release();await rooms.getByText('登入狀態已變更，請重新執行操作',{exact:true}).waitFor();
   assert.equal(await rooms.locator('.room-row').count(),0);assert.equal(await detail.textContent(),'');
   assert.equal(await rooms.getByLabel('查詢房間代碼（8碼）').inputValue(),'');
   assert.deepEqual(errors,[]);
   console.log(`PASS: ${name} 六題題庫、主持人開始、同房間重載、玩家三回合600分、D1歸檔、連線失敗原因顯示、後台房間狀態／375px／跨分頁登出／遲到回應攔截`);
  } finally {
   if(bank) await api(`/api/admin/banks/${bank.id}`,{revision},'DELETE');
   await browser.close();
  }
 }
})().catch(error=>{console.error(error);process.exitCode=1});
