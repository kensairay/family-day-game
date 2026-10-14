"""Run with npm run test:browser (isolated local Workers/DO/D1 state)."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ["GAME_URL"]
HOST_KEY = os.environ["GAME_HOST_KEY"]
ARTIFACTS = Path('.test-artifacts/browser')
ARTIFACTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host_context = browser.new_context()
    first = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    second = browser.new_context(viewport={"width": 320, "height": 568}, is_mobile=True, has_touch=True)
    screen_context = browser.new_context(viewport={"width": 1280, "height": 720})
    host, a, b, screen = host_context.new_page(), first.new_page(), second.new_page(), screen_context.new_page()
    errors = []
    for page in [host, a, b, screen]:
        page.on("pageerror", lambda error: errors.append(str(error)))
    host.goto(BASE + "/host.html")
    host.fill("#hostKey", HOST_KEY)
    host.click("#loginBtn")
    expect(host.locator("#startBtn")).to_be_visible()
    expect(host.locator("#qr")).to_have_attribute("src", __import__("re").compile("^data:image/svg"))
    for page in [a, b]:
        page.goto(BASE)
        expect(page.locator("#joinBtn")).to_be_visible()
        page.fill("#nickname", "小明")
        page.click("#joinBtn")
        expect(page.locator("#identity")).to_contain_text("小明")
    assert a.locator("#identity").inner_text() == "你的暱稱：小明"
    assert b.locator("#identity").inner_text().startswith("你的暱稱：小明-")
    screen.goto(BASE + "/screen.html")
    host.click("#startBtn")
    expect(a.locator("#question")).to_contain_text("一年有幾個月")
    expect(screen.locator("#question")).to_contain_text("一年有幾個月")
    a.locator(".answer").nth(2).click()
    expect(a.locator("#feedback")).to_contain_text("已收到")
    expect(a.locator("#score")).to_have_text("0 分")
    assert a.locator(".correct").count() == 0
    a.screenshot(path=str(ARTIFACTS / "family-day-player.png"), full_page=True)
    # Background/offline recovery must retain identity and receipt.
    first.set_offline(True)
    first.set_offline(False)
    a.reload()
    expect(a.locator("#identity")).to_have_text("你的暱稱：小明")
    expect(a.locator("#feedback")).to_contain_text("已收到")
    host.click("#revealBtn")
    expect(a.locator("#score")).to_have_text("260 分")
    expect(b.locator("#score")).to_have_text("0 分")
    expect(b.locator("#feedback")).to_contain_text("未作答")
    expect(screen.locator(".correct")).to_have_count(1)
    screen.screenshot(path=str(ARTIFACTS / "family-day-screen.png"), full_page=True)
    for i, choice in enumerate([None, 1, 3, 0, 2, 1, 1, 2, 3]):
        if i == 0:
            continue
        host.click("#nextBtn")
        expect(a.locator("#roundName")).to_contain_text(["第一", "第二", "第三"][i // 3])
        expect(a.locator(".answer:enabled")).to_have_count(4)
        if i == 1:
            # An offline selection must not claim server receipt; reconnect replays it.
            first.set_offline(True)
            a.locator(".answer").nth(choice).click()
            expect(a.locator("#retryBtn")).to_be_visible()
            assert "已收到" not in a.locator("#feedback").inner_text()
            first.set_offline(False)
        else:
            a.locator(".answer").nth(choice).click()
        expect(a.locator("#feedback")).to_contain_text("已收到")
        host.click("#revealBtn")
        expect(a.locator("#score")).to_have_text(f"{(i + 1) * 260} 分")
    host.click("#nextBtn")
    expect(a.locator("#phaseHeading")).to_have_text("三回合完成！")
    host.fill("#finalRank", "1")
    host.click("#saveRankBtn")
    expect(a.locator("#feedback")).to_contain_text("最終名次：第 1 名")
    host.reload()
    expect(host.locator("#finalRankPanel")).to_be_visible()
    for page in [a, b, host, screen]:
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert not errors, errors
    browser.close()
    print("PASS: separate host/player/projector, QR, mobile widths, same names, receipt, offline retry, reload, 3 rounds, final rank")
