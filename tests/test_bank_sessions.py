"""Real XLSX import + new-session regression, using committed sample fixtures."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
BASE=os.environ['GAME_URL']
KEY=os.environ['GAME_HOST_KEY']
ARTIFACTS=Path('.test-artifacts/bank-sessions-browser')
ARTIFACTS.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True, executable_path=os.environ.get('GAME_CHROMIUM_PATH'))
 hc=browser.new_context(viewport={'width':390,'height':844})
 pc=browser.new_context(viewport={'width':320,'height':568},is_mobile=True,has_touch=True)
 sc=browser.new_context(viewport={'width':1280,'height':720})
 host,player,screen=hc.new_page(),pc.new_page(),sc.new_page()
 errors=[]
 for page in [host,player,screen]:page.on('pageerror',lambda e:errors.append(str(e)))
 host.goto(BASE+'/host.html');host.fill('#hostKey',KEY);host.click('#loginBtn')
 expect(host.locator('#bankFile')).to_be_visible()
 with host.expect_download() as info:host.click('#templateLink')
 assert info.value.suggested_filename.endswith('.xlsx')
 host.set_input_files('#bankFile','tests/fixtures/bank-empty-answer.xlsx')
 expect(host.locator('#bankStatus')).to_contain_text('正確答案')
 expect(host.locator('#publishBankBtn')).to_be_disabled()
 host.set_input_files('#bankFile','tests/fixtures/bank-numeric-options.xlsx')
 expect(host.locator('#bankPreview')).to_contain_text('2026')
 host.set_input_files('#bankFile','tests/fixtures/bank-invalid.xlsx')
 expect(host.locator('#bankStatus')).to_contain_text('第 3 列')
 expect(host.locator('#publishBankBtn')).to_be_disabled()
 host.set_input_files('#bankFile','tests/fixtures/bank-valid.xlsx')
 expect(host.locator('#bankStatus')).to_contain_text('4 題')
 expect(host.locator('#bankPreview')).to_contain_text('正式題目4')
 host.click('#publishBankBtn');host.click('#cancelActionBtn')
 expect(host.locator('#bankSummary')).to_contain_text('9 題')
 host.click('#publishBankBtn');host.click('#confirmActionBtn')
 expect(host.locator('#bankSummary')).to_contain_text('4 題')
 host.reload();expect(host.locator('#bankSummary')).to_contain_text('4 題')
 player.goto(BASE);player.fill('#nickname','小明');player.click('#joinBtn')
 expect(player.locator('#identity')).to_contain_text('小明')
 offline_ctx=browser.new_context(viewport={'width':320,'height':568},is_mobile=True,has_touch=True)
 offline=offline_ctx.new_page();offline.goto(BASE);offline.fill('#nickname','離線同伴');offline.click('#joinBtn')
 expect(offline.locator('#identity')).to_contain_text('離線同伴')
 screen.goto(BASE+'/screen.html')
 host.click('#startBtn')
 expect(host.locator('#bankFile')).to_be_disabled()
 for i in range(4):
  expect(player.locator('#question')).to_have_text(f'正式題目{i+1}')
  player.locator('.answer').nth(1).click();expect(player.locator('#feedback')).to_contain_text('已收到')
  host.click('#revealBtn');expect(player.locator('#score')).to_have_text(f'{(i+1)*260} 分')
  if i==0:expect(host.locator('#nextBtn')).to_have_text('下一題 →')
  if i==1:
   expect(host.locator('#nextBtn')).to_have_text('進行下一回合 →')
   expect(player.locator('#feedback')).to_contain_text('答對了')
   expect(player.locator('.correct')).to_have_count(1)
   expect(screen.locator('#rankPanel')).to_be_hidden()
   expect(host.locator('#finalRankPanel')).to_be_hidden()
   late_context=browser.new_context(viewport={'width':320,'height':568},is_mobile=True,has_touch=True)
   late=late_context.new_page();late.goto(BASE);late.fill('#nickname','中途加入');late.click('#joinBtn')
   expect(late.locator('#phaseHeading')).to_have_text('第 1 回合結束')
   expect(late.locator('#score')).to_have_text('0 分')
   assert '中途加入' not in screen.locator('#leaderboard').inner_text()
   import uuid
   for number in range(10):
    joined=host.request.post(BASE+'/api/rooms/family-day/join',data={'token':str(uuid.uuid4()),'nickname':f'來賓{number}'})
    assert joined.status==200
  if i==2:
   expect(late.locator('#phaseHeading')).to_have_text('第 2 回合結束')
   expect(screen.locator('#rankPanel')).to_be_hidden()
  if i==3:
   expect(screen.locator('#rankPanel')).to_be_hidden()
   expect(host.locator('#nextBtn')).to_have_text('結束遊戲並確認排行榜 →')
  host.click('#nextBtn')
 expect(screen.locator('#rankPanel')).to_be_hidden();expect(host.locator('#publishPanel')).to_be_visible()
 expect(player.locator('#phaseHeading')).to_have_text('遊戲完成！')
 expect(host.locator('#leaderboard')).to_contain_text('第 1 回合')
 expect(host.locator('#leaderboard')).to_contain_text('第 2 回合')
 assert player.locator('#leaderboard details').count()==0
 expect(player.locator('#scoreLabel')).to_have_text('個人累積分數')
 # Cancellation must preserve the finished game.
 host.fill('#sessionTitle','正式家庭日');host.click('#newSessionBtn');host.click('#cancelActionBtn')
 expect(player.locator('#score')).to_have_text('1040 分')
 offline_ctx.set_offline(True)
 # The first new-session request commits, but its acknowledgment is lost.
 calls=[]
 def lose_ack(route):
  body=route.request.post_data_json
  if body.get('action')=='new-session':
   calls.append(body)
   if len(calls)==1:assert route.fetch().status==200
   route.abort('failed')
  else:route.continue_()
 host.route('**/api/rooms/family-day/host',lose_ack)
 host.click('#newSessionBtn');host.click('#confirmActionBtn')
 expect(host.locator('#retryHostBtn')).to_be_visible();expect(host.locator('#retryHostBtn')).to_be_enabled()
 host.unroute('**/api/rooms/family-day/host',lose_ack);host.click('#retryHostBtn')
 expect(host.locator('#retryHostBtn')).to_be_hidden()
 expect(host.locator('#sessionLabel')).to_contain_text('正式家庭日')
 expect(host.locator('#playerCount')).to_contain_text('0 人')
 expect(host.locator('#bankSummary')).to_contain_text('4 題')
 expect(player.locator('#joinBtn')).to_be_visible()
 expect(player.locator('#notice')).to_contain_text('新場次')
 expect(screen.locator('#phaseHeading')).to_have_text('準備好了嗎？')
 offline_ctx.set_offline(False)
 expect(offline.locator('#joinBtn')).to_be_visible(timeout=15000)
 expect(offline.locator('#notice')).to_contain_text('新場次')
 expect(host.locator('#historySession option')).to_have_count(1)
 with host.expect_download() as history:host.click('#downloadHistoryBtn')
 history_path=ARTIFACTS/'old-session.json';history.value.save_as(history_path)
 import json
 old=json.loads(history_path.read_text())
 assert old['players'][0]['score']==260 and old['players'][0]['roundResults']['1']['score']==520 and len(old['bank'])==4
 # Rejoin the same URL with a new score and try the imported bank again.
 player.fill('#nickname','小明');player.click('#joinBtn');expect(player.locator('#score')).to_have_text('0 分')
 host.click('#startBtn');expect(player.locator('#question')).to_have_text('正式題目1')
 expect(player.locator('.answer:enabled')).to_have_count(4)
 player.reload();expect(player.locator('#identity')).to_contain_text('小明')
 assert len({c['commandId'] for c in calls})==1
 for page in [host,player,screen]:assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
 host.screenshot(path=str(ARTIFACTS/'host.png'),full_page=True)
 assert not errors,errors
 browser.close()
 print('PASS: actual XLSX download/errors/preview/cancel/publish, variable round sizes, import lock, new-session cancellation/receipt loss, all views update, old history download, clean rejoin')
