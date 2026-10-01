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

## 2026-10-01 規則與 prototype 更新

本節取代上文的隊伍、三題自動換題與即時公布答案規則：

- 一人一機，不分隊，個人積分。
- 暱稱已被使用時加亂數編號；正式版由伺服器確保房間內唯一。
- 主持人出題；玩家選答案後顯示接收確認，不提前揭曉。
- 主持人按「公布答案」停止收答案並計分；答對固定分數，答錯或未作答 0 分，沒有速度加成。
- 主持人按「下一題」，三回合累積積分；目前不設自動倒數收題。
- 同分並列，需要決定獲獎名次時上台決勝，主持人另行登記最終結果，保留答題積分。

目前 `dist/index.html` 以三回合、每回合三題示範上述流程，主持人按鈕在玩家頁面內。暱稱去重、進度恢復、已完成玩家排行榜及決勝名次只儲存在同一瀏覽器的 localStorage；尚無伺服器、多人同步或跨設備唯一暱稱。正式版需分離主持人／玩家／投影畫面並由伺服器確認答案。

目前 repository 中的 `dist/index.html` 是開發來源；上文 Windows 路徑為歷史背景。發布仍需使用者明確指示。
