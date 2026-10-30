import os, uuid
from playwright.sync_api import sync_playwright, expect
base=os.environ['GAME_URL']; key=os.environ['GAME_HOST_KEY']
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('GAME_CHROMIUM_PATH'))
 host=browser.new_page(viewport={'width':320,'height':568}); player=browser.new_page(viewport={'width':390,'height':844}); screen=browser.new_page(viewport={'width':1280,'height':720})
 host.goto(base+'/host.html');host.fill('#hostKey',key);host.click('#loginBtn');expect(host.locator('#startBtn')).to_be_visible()
 bank=[{'round':r,'roundName':f'回合{r}','text':f'題目{r}','options':['甲','乙','丙','丁'],'correct':0} for r in range(1,5)]
 state=host.request.get(base+'/api/rooms/family-day/state?role=host',headers={'Authorization':'Bearer '+key}).json()
 resp=host.request.post(base+'/api/rooms/family-day/host',headers={'Authorization':'Bearer '+key},data={'action':'import-bank','revision':state['revision'],'commandId':str(uuid.uuid4()),'bank':bank});assert resp.status==200,resp.text()
 player.goto(base);player.fill('#nickname','玩家甲');player.click('#joinBtn');screen.goto(base+'/screen.html');host.click('#startBtn')
 for i in range(4):
  expect(host.locator('#revealBtn')).to_be_visible();box=host.locator('#revealBtn').bounding_box();assert box['y']>=0 and box['y']+box['height']<=568
  player.locator('.answer').first.click();expect(player.locator('#feedback')).to_contain_text('已收到');host.click('#revealBtn');expect(player.locator('#score')).to_have_text(f'{(i+1)*260} 分')
  expect(player.locator('#rankPanel')).to_be_hidden();expect(screen.locator('#rankPanel')).to_be_hidden();host.click('#nextBtn')
 expect(screen.locator('#rankPanel')).to_be_hidden();expect(screen.locator('#invitePanel')).to_be_visible();expect(host.locator('#publishPanel')).to_be_visible();host.click('#publishRankBtn');host.click('#confirmActionBtn');expect(screen.locator('#rankPanel')).to_be_visible();expect(screen.locator('#leaderboard')).to_contain_text('1040 分');expect(player.locator('#prizeDialog')).to_be_visible();player.fill('#realName','王小明');player.click('#prizeForm button');expect(host.locator('#prizeRoster')).to_contain_text('王小明');assert '王小明' not in screen.content();expect(host.locator('#leaderboard details')).to_have_count(4);assert player.locator('#leaderboard details').count()==0
 browser.close();print('PASS: four rounds, private rankings, cumulative score, host recall, mobile action')
