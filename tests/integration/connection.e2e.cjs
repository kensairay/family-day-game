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
   const playerContext=await browser.newContext({viewport:{width:375,height:800}});
   const player=await playerContext.newPage(); player.on('pageerror',e=>errors.push(e.message));
   await player.goto(base+'/?room='+room); await player.getByLabel('你的暱稱').fill('連線試玩');
   await player.getByRole('button',{name:'加入遊戲',exact:true}).click();
   await page.getByText('目前 1 人在線／1 人已加入',{exact:true}).waitFor();
   await page.reload(); await page.getByText('目前 1 人在線／1 人已加入',{exact:true}).waitFor();
   for(let i=0;i<questions.length;i++) {
    if(i%2===0) await page.getByRole('button',{name:i===0?'開始第一回合':'開始下一回合',exact:true}).click();
    const q=questions[i];
    await page.getByRole('heading',{name:q.text,exact:true}).waitFor();
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
   await playerContext.close();
   // Simulate a blocked WebSocket and an expired room. The initial loading
   // text must become an actionable reason, without enabling host commands.
   await page.routeWebSocket('**/socket',ws=>ws.close());
   await page.route('**/connection',route=>route.fulfill({status:410,contentType:'application/json',body:'{"error":"房間已關閉或到期"}'}));
   await page.reload();
   await page.locator('.card').getByText('房間已關閉或到期，請從主持人入口建立新房間。',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'開始第一回合',exact:true}).count(),0);
   assert.deepEqual(errors,[]);
   console.log(`PASS: ${name} 六題題庫、主持人開始、同房間重載、玩家三回合600分、D1歸檔、連線失敗原因顯示`);
  } finally {
   if(bank) await api(`/api/admin/banks/${bank.id}`,{revision},'DELETE');
   await browser.close();
  }
 }
})().catch(error=>{console.error(error);process.exitCode=1});
