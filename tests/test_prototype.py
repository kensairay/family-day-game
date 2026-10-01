"""Run against a local preview: python tests/test_prototype.py"""
from playwright.sync_api import sync_playwright


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://localhost:8000")
        page.fill("#nickname", "小明")
        page.click("#joinBtn")
        assert page.locator("#playerName").inner_text() == "小明"
        page.click("#startBtn")
        correct = [2, 1, 3, 0, 2, 1, 1, 2, 3]

        def answer(index, choice):
            # One unanswered question and one wrong answer in each run.
            if index != 1:
                page.locator(".answer").nth(choice if index != 2 else 0).click()
                assert "已收到" in page.locator("#feedback").inner_text()
                assert page.locator(".correct").count() == 0

        for index, choice in enumerate(correct):
            answer(index, choice)
            old_score = page.locator("#score").inner_text()
            page.reload()
            assert page.locator("#score").inner_text() == old_score
            page.click("#revealBtn")
            expected = 260 * max(0, index - 1) if index >= 2 else 260
            assert page.locator("#score").inner_text() == f"{expected} 分"
            assert page.locator(".answer:enabled").count() == 0
            # A repeated host command must not score the question again.
            page.evaluate("document.getElementById('revealBtn').click()")
            assert page.locator("#score").inner_text() == f"{expected} 分"
            page.reload()
            assert page.locator("#nextBtn").is_visible()
            page.click("#nextBtn")

        assert page.locator("#result").is_visible()
        assert "1820" in page.locator("#resultCopy").inner_text()
        page.fill("#finalRank", "0")
        page.click("#saveRankBtn")
        assert "請輸入" in page.locator("#rankFeedback").inner_text()
        page.fill("#finalRank", "1")
        page.click("#saveRankBtn")
        assert "上台決勝：第 1 名" in page.locator("#leaderboard").inner_text()
        page.click("#newPlayerBtn")
        page.fill("#nickname", "小明")
        page.click("#joinBtn")
        assert page.locator("#playerName").inner_text().startswith("小明-")
        page.click("#startBtn")
        for index, choice in enumerate(correct):
            answer(index, choice)
            page.click("#revealBtn")
            page.click("#nextBtn")
        assert page.locator("#leaderboard").inner_text().count("並列 第 1 名") == 2
        page.click("#againBtn")
        page.click("#startBtn")
        assert page.locator("#score").inner_text() == "0 分"
        for width, height in [(320, 568), (390, 844), (768, 1024)]:
            page.set_viewport_size({"width": width, "height": height})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), width
        assert not errors, errors
        browser.close()
        print("PASS: host flow, scoring, recovery, three rounds, duplicate names, ties, final rank, restart, viewport widths")


if __name__ == "__main__":
    main()
