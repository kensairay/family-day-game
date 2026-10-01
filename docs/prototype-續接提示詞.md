# 家庭日手機網頁小遊戲 Prototype｜續接提示詞

請接續製作「家庭日手機網頁小遊戲」prototype。

## 背景

- 公司家庭日活動日期：10/31
- 預計同時參加人數：約 250 人
- 現場沒有免費 Wi‑Fi，參加者使用自己的手機行動網路
- 目標是免安裝 App、掃 QR Code 即可加入
- 目前先做 prototype，不需要真正多人同步後端

## 已完成的內容

- 已建立手機優先的單頁網站 prototype
- 視覺風格：深藍、珊瑚橘、黃色、薄荷綠；活潑、家庭日、適合手機操作
- 已完成流程：
  1. 輸入暱稱加入遊戲
  2. 等待開始畫面
  3. 顯示隊伍「橘子汽水隊」
  4. 三題限時選擇題
  5. 每題 15 秒倒數
  6. 答對加分、答錯顯示正確答案
  7. 顯示目前分數
  8. 顯示遊戲完成與排行榜
  9. 可重新開始
- 目前資料都在瀏覽器前端，尚未接資料庫、WebSocket、真正多人同步或主持人後台

## 主要檔案

- 原始 prototype：
  `C:\Users\e292879.EVERGREENEITC\Documents\Codex\2026-10-01\new-chat\dist\index.html`

- 目前準備發布的獨立來源：
  `C:\Users\e292879.EVERGREENEITC\Documents\Codex\2026-10-01\new-chat\site-source\dist\index.html`

- Sites 設定：
  `C:\Users\e292879.EVERGREENEITC\Documents\Codex\2026-10-01\new-chat\site-source\.openai\hosting.json`

## Sites 狀態

- 已成功建立私人 Site，不要再次呼叫 create_site
- Site title：家庭日｜全員出動 Prototype
- Site slug：`family-day-game-prototype`
- `project_id`：`appgprj_6abdabb4db9c8191bd916ac69b8e03e2`
- 預期網址：`https://family-day-game-prototype.phtsv9t.chatgpt.site`

## 遇到的問題

- prototype 內容本身沒有問題
- 發布時，Sites workflow 需要初始化 Git 並上傳來源
- 原工作區的 `.git` 目錄出現 `Permission denied`
- 後來建立 `site-source` 目錄重新封裝，但 workflow 仍在初始化 `.git` 時遇到 `Permission denied`
- 曾嘗試使用升級權限執行 workflow，但執行時間過長，之後被使用者中止
- 尚未取得成功發布的 live URL
- 不要暴露或重新使用先前的 Git token；如需要，請為同一個 project 重新取得新的 source repository credential

## 目前決定

- 使用者已要求暫時停止線上發布嘗試
- 在使用者明確要求前，不要再次執行 Sites 發布、Git 上傳或線上部署

## 未來若使用者要求繼續發布

1. 先確認 `site-source` 內的 `index.html` 與 `hosting.json` 存在且內容正確。
2. 不要重新建立 Site，沿用既有 `project_id`。
3. 解決 Sites workflow 的 Git 權限或改用可行的替代發布流程。
4. 將目前的 static prototype 發布成私人預覽。
5. 成功後回覆可直接開啟的網址。
6. 發布成功後，再考慮加入：
   - 主持人控制台
   - 真正多人同步
   - QR Code 加入
   - 題庫編輯
   - 斷線重連
   - 250 人壓力測試
