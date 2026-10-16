# 家庭日｜全員出動

約 250 人、一人一機的公司家庭日答題遊戲，三回合約 20 分鐘。成人與兒童以手機瀏覽器參與，主持人控制進度，投影幕顯示題目與排名。

## 多人 MVP、正式題庫與現場控場

- 輸入暱稱加入同一活動房間。同名由伺服器加四位亂數編號，再檢查唯一性。
- 主持人手動開始、公布答案並計分、進入下一題／回合及結束遊戲。
- 可暫停／恢復原題；已收到的答案保留，未確認的手機答案等恢復後重送。
- 可附理由跳題：先預覽確認，整題不計分、不公布正解，再手動下一題。
- 可附理由補分／扣分：先預覽前後分數再確認，重試不重複加分；不接受負總分。登記決勝名次後禁止改分。
- 操作回覆遺失時，控制台提供獨立「重試上次操作」並暫停其他變更，避免錯誤重做。
- 玩家每題送出一次答案，伺服器持久化接收後才顯示「已收到」。重送回傳原接收結果。
- 主持人公布前不傳正解；公布後停止接受新答案。答對固定 260 分，錯答／未作答 0 分，沒有速度加成或自動倒數。
- 內建三回合各三題示範題庫；主持人可下載 Excel 範本，預覽並發布正式題庫，三回合各 1～20 題。個人分數累積，同分並列，不以回答時間排序。投影結束時顯示前 10 位，手機與主持人可看完整排行。
- 遊戲結束後主持人登記上台決勝名次，保留原積分。
- 主持人可直接建立新場次，沿用已發布題庫、重新加入並從零計分；同一網址／登入碼繼續使用，舊場紀錄可下載，不必修改 ROOM_CODE 或再部署。
- 玩家刷新、切換 App 或斷線後恢復身份與狀態；待送答案保存在本機，重連後重試，舊題答案會被拒絕。
- Durable Object 持久化房間資料；D1 非同步封存事件，失敗保留 outbox 重試。主持人可匯出玩家、答案與操作紀錄 JSON，匯出不含身份憑證。

這是可在本機多人測試的核心版本，**尚未部署，也尚未通過真實行動網路及手機實機彩排**。本機容量測試不能取代正式平台壓力測試。

## 程式結構

```text
src/questions.js         伺服器題庫與固定分值
src/game.js              加入、收答案、主持人指令、排名規則
src/worker.js            Worker API、Durable Object、WebSocket、D1 outbox
migrations/              D1 事件封存 schema
wrangler.jsonc           Cloudflare 本機／正式環境設定
shared/                  前後端共用題庫驗證與 XLSX ZIP 限制
client/xlsx-worker.js    主持人 Excel 背景解析
scripts/prepare-assets.js  準備 QR Code 與 Excel worker，無外部 CDN 依賴
dist/index.html          玩家頁面（/）
dist/host.html           主持人控制台
dist/screen.html         只讀投影畫面
dist/question-bank-template.xlsx  可直接下載的題庫範本
dist/app.js、styles.css  共用前端
prototype/index.html     保留上一版純本機示範，未包含在正式靜態資產內
tests/                  遊戲規則、整合與瀏覽器測試
```

## 本機多人預覽

需要 Node.js 22.12+（此版本驗證使用 Node.js 24）。

```sh
npm ci
cp .dev.vars.example .dev.vars
```

在 `.dev.vars` 設定自己的 `HOST_KEY`（至少 16 字元）。不要提交或分享登入碼。

```sh
npm run db:local
npm run dev
```

- 玩家：`http://localhost:8787/`
- 主持人：`http://localhost:8787/host.html`
- 投影：`http://localhost:8787/screen.html`

主持人及投影頁會產生加入連結與 QR Code。`localhost` QR Code 只能在該電腦開啟，手機測試需使用手機可連線的預覽位址；正式活動使用 HTTPS 公開位址。本輪沒有公開發布。

`ROOM_CODE` 預設為 `family-day`，現在代表一個活動服務；同一服務內可由主持人建立多場，不必為彩排反覆更改此值。每場有自己的 sessionId，舊分數與題庫會保留；更改 ROOM_CODE 仍會切換到另一個獨立活動資料空間。

玩家身份保存在 localStorage，主持人登入保存在 sessionStorage。新場建立後，玩家需確認暱稱重新加入，分數從零開始；離線重連亦會收到新場提示。清除資料或換手機仍無法恢復同場舊身份；此階段沒有員工名單核身。

## Excel 題庫與建立新場

1. 主持人頁選「下載 Excel 題庫範本」，保留「題庫」工作表與八個欄位，填入正式問題。
2. 在等待開始的場次選擇 .xlsx，確認逐列檢查及完整預覽，再按「預覽發布題庫」→「確認執行」。正式題庫不必放進 GitHub。
3. 遊戲開始後題庫鎖定，答對固定 260 分；可變題數的三回合仍由主持人手動換題。
4. 本場完成後填寫新場次名稱，按「建立新場次」並確認。題庫沿用、玩家／分數重開，QR Code 與登入碼不變。
5. 「過去場次紀錄」可下載各場題庫、分數及答題／操作事件；一般下載按鈕只下載目前場次。

新場只能在本場結束或尚無玩家的等待場建立，避免覆蓋進行中的活動。操作細節與限制見 [Excel 題庫與場次操作](docs/Excel題庫與場次操作.md)。

## 驗證

已安裝專案依賴及 Playwright Chromium 時，可一鍵執行完整本機驗收：

```sh
npm run acceptance
```

驗收使用公開測試 fixture，不使用實際帳號／金鑰。若專案內已有 `.env`／`.dev.vars`，會拒絕啟動本機整合驗收，請使用沒有實際環境檔的專案副本；不需刪除或搬動原設定。所有測試資料、log、截圖與 dry-run 產物保存在 `.test-artifacts/`，不自動刪除，也不提交 Git。最新結果路徑保存在 `.test-artifacts/latest-acceptance.json`。

個別驗收：

```sh
npm test
npm run test:bank-sessions
npm run test:bank-sessions:browser
npm run test:controls
npm run test:controls:browser
npm run test:integration
npm run check
```

- 規則測試：暱稱去重、答案與主持人指令去重、固定計分、同分並列、三回合及 350 人容量。
- 整合測試：啟動隔離本機 Worker／DO／D1，350 玩家及 WebSocket 連線、集中提交、揭曉、重連、匯出、整個服務重啟後恢復，以及 D1 暫時無法使用後的封存補寫。測試設定及資料保留在專案 .test-artifacts/，不使用雲端資源。
- 題庫／場次驗收：真實 .xlsx 範本與錯誤列、伺服器再驗證、變動題數、題庫持久化、建立新場重試、歷史下載、在線／離線舊玩家重新加入。
- 控場驗收：暫停、423 與答案保留、跳題、補扣分稽核、過期預覽，以及伺服器已提交但回覆遺失時的重試。
- `check` 僅執行部署 dry-run，不上傳、不部署。

瀏覽器驗證：

```sh
python -m pip install playwright
python -m playwright install chromium
npm run test:browser
```

涵蓋不同瀏覽器 context 的玩家／主持人／投影畫面、QR Code、320／390 像素手機寬度、離線重送、重新整理及三回合流程。這是 Chromium 模擬，不代表 iPhone Safari／Android 實機已驗證。

舊示範可執行 `python -m http.server 8000 --directory prototype`，另開終端執行 `python tests/test_prototype.py`。

## 正式上線前

先完成真實手機彩排、Cloudflare 已部署環境的 300～350 連線測試，以及現場弱網／重連尖峰測試。仍待補的現場功能包含身份人工恢復、主持人備援演練及監控。正式題庫、每回合題數與活動時間需要彩排確認。

Cloudflare 佈署準備見 `docs/多人MVP開發與驗證.md`。目前 `database_id` 是本機用 placeholder，正式版需配置實際 D1 ID 與私密 HOST_KEY；不應直接照目前設定上線。既有 `.openai/hosting.json` 僅保留歷史 Sites 設定，不能提供本次 Worker 後端。

開發計畫、實際驗收結果與接手資訊見 `PROGRESS.md`，規則取捨見 `DECISIONS.md`。使用者已授權將控場分支 `feat/event-host-controls` 推送 GitHub；尚未合併 main 或部署網站。請切換此分支取得最新功能。

更新到此版本後，所有裝置先重新整理一次載入新介面；此後新場次不需要重新部署。沒有新增 D1 schema 或 Cloudflare binding。可選的 scripts/generate-question-template.py 使用 openpyxl 重新產生範本及示範測試檔；一般部署與驗收直接使用已提交檔案，不需安裝這個 Python 套件。
