"""Additional acceptance: real browser control flow and ambiguous host responses."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ['GAME_URL']
HOST_KEY = os.environ['GAME_HOST_KEY']
ARTIFACTS = Path('.test-artifacts/host-controls')
ARTIFACTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('GAME_CHROMIUM_PATH'))
    main_ctx = browser.new_context(viewport={'width': 390, 'height': 844})
    backup_ctx = browser.new_context()
    a_ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    b_ctx = browser.new_context(viewport={'width': 320, 'height': 568}, is_mobile=True, has_touch=True)
    screen_ctx = browser.new_context(viewport={'width': 1280, 'height': 720})
    host, backup, a, b, screen = [ctx.new_page() for ctx in [main_ctx, backup_ctx, a_ctx, b_ctx, screen_ctx]]
    errors = []
    for page in [host, backup, a, b, screen]:
        page.on('pageerror', lambda error: errors.append(str(error)))
    for page in [host, backup]:
        page.goto(BASE + '/host.html')
        page.fill('#hostKey', HOST_KEY)
        page.click('#loginBtn')
        expect(page.locator('#startBtn')).to_be_visible()
    for page, name in [(a, '甲'), (b, '乙')]:
        page.goto(BASE)
        page.fill('#nickname', name)
        page.click('#joinBtn')
        expect(page.locator('#identity')).to_contain_text(name)
    screen.goto(BASE + '/screen.html')
    host.click('#startBtn')
    expect(a.locator('.answer:enabled')).to_have_count(4)
    a.locator('.answer').nth(2).click()
    expect(a.locator('#feedback')).to_contain_text('已收到')
    b_ctx.set_offline(True)
    b.locator('.answer').nth(2).click()
    expect(b.locator('#retryBtn')).to_be_visible()
    host.click('#pauseBtn')
    expect(a.locator('#phaseHeading')).to_have_text('遊戲暫停')
    expect(a.locator('.answer:enabled')).to_have_count(0)
    b_ctx.set_offline(False)
    expect(b.locator('#phaseHeading')).to_have_text('遊戲暫停')
    expect(b.locator('#feedback')).to_contain_text('暫停')
    assert '已收到' not in b.locator('#feedback').inner_text()
    expect(screen.locator('#phaseHeading')).to_have_text('遊戲暫停')
    assert a.locator('.correct').count() == 0
    a.screenshot(path=str(ARTIFACTS / 'paused-player.png'), full_page=True)
    host.click('#resumeBtn')
    expect(b.locator('#feedback')).to_contain_text('已收到')
    host.click('#revealBtn')
    expect(a.locator('#score')).to_have_text('260 分')
    expect(b.locator('#score')).to_have_text('260 分')

    def preview_adjustment(delta='260'):
        host.select_option('#adjustPlayer', label='甲 · 260 分')
        host.fill('#adjustDelta', delta)
        host.fill('#adjustReason', '現場核對補分')
        host.click('#previewAdjustmentBtn')

    # Negative resulting scores are refused before sending a command.
    preview_adjustment('-520')
    expect(host.locator('#notice')).to_contain_text('0')
    expect(host.locator('#confirmationPanel')).to_be_hidden()
    preview_adjustment()
    expect(host.locator('#confirmationText')).to_contain_text('520')
    host.click('#cancelActionBtn')
    expect(a.locator('#score')).to_have_text('260 分')
    # A preview must keep its old revision when another host advances.
    preview_adjustment()
    backup.click('#nextBtn')
    expect(a.locator('#question')).to_contain_text('紅燈')
    host.click('#confirmActionBtn')
    expect(host.locator('#notice')).to_contain_text('進度已更新')
    expect(a.locator('#score')).to_have_text('260 分')
    host.click('#pauseBtn')
    expect(a.locator('#phaseHeading')).to_have_text('遊戲暫停')
    preview_adjustment()
    # Commit to server, then lose all POST acknowledgments until manual retry.
    post_calls = []
    def lose_ack(route):
        body = route.request.post_data_json
        post_calls.append(body)
        if len(post_calls) == 1:
            response = route.fetch()
            assert response.status == 200
        route.abort('failed')
    host.route('**/api/rooms/family-day/host', lose_ack)
    host.click('#confirmActionBtn')
    expect(a.locator('#score')).to_have_text('520 分')
    expect(host.locator('#retryHostBtn')).to_be_visible()
    expect(host.locator('#retryHostBtn')).to_be_enabled()
    expect(host.locator('#resumeBtn')).to_be_disabled()
    host.unroute('**/api/rooms/family-day/host', lose_ack)
    host.click('#retryHostBtn')
    expect(host.locator('#retryHostBtn')).to_be_hidden()
    expect(a.locator('#score')).to_have_text('520 分')
    expect(host.locator('#adjustDelta')).to_have_value('')
    expect(host.locator('#adjustReason')).to_have_value('')
    assert len({body['commandId'] for body in post_calls}) == 1

    # Skip cancellation preserves the question; confirming voids it, not its score history.
    host.fill('#skipReason', '題目顯示有誤')
    host.click('#requestSkipBtn')
    host.click('#cancelActionBtn')
    expect(a.locator('#phaseHeading')).to_have_text('遊戲暫停')
    host.click('#requestSkipBtn')
    host.click('#confirmActionBtn')
    expect(a.locator('#phaseHeading')).to_have_text('本題跳過')
    expect(a.locator('#feedback')).to_contain_text('不計分')
    expect(screen.locator('#phaseHeading')).to_have_text('本題跳過')
    assert a.locator('.correct').count() == 0
    host.screenshot(path=str(ARTIFACTS / 'host-skipped.png'), full_page=True)
    for i in range(2, 9):
        host.click('#nextBtn')
        expect(a.locator('.answer:enabled')).to_have_count(4)
        host.fill('#skipReason', '活動時間調整')
        host.click('#requestSkipBtn')
        host.click('#confirmActionBtn')
        expect(a.locator('#phaseHeading')).to_have_text(f'第 {i//3+1} 回合結束' if i % 3 == 2 else '本題跳過')
    host.select_option('#finalPlayer', label='甲 · 0 分')
    host.fill('#finalRank', '1')
    host.click('#saveRankBtn')
    expect(a.locator('#feedback')).to_contain_text('最終名次：第 1 名')
    expect(host.locator('#previewAdjustmentBtn')).to_be_disabled()
    host.click('#nextBtn')
    expect(a.locator('#phaseHeading')).to_have_text('三回合完成！')
    exported = host.request.get(BASE + '/api/rooms/family-day/export', headers={'Authorization': 'Bearer ' + HOST_KEY}).json()
    adjustments = [e for e in exported['events'] if e['data'].get('action') == 'adjust-score']
    assert len(adjustments) == 1
    assert adjustments[0]['data']['before'] == 260 and adjustments[0]['data']['after'] == 520
    for page in [a, b, host, screen]:
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    # Repeated network changes must settle on one current socket and preserve identity.
    for _ in range(3):
        a_ctx.set_offline(True)
        a_ctx.set_offline(False)
    expect(a.locator('#connection')).to_have_text('已連線', timeout=15000)
    a.reload()
    expect(a.locator('#score')).to_have_text('520 分')
    expect(a.locator('#identity')).to_have_text('你的暱稱：甲')
    assert not errors, errors
    browser.close()
    print('PASS: pause/resume with offline pending answer, skip/adjust confirmations and cancellation, stale host preview, lost POST acknowledgment idempotency, final rank guard, mobile widths')
