# 家庭日｜全員出動

約 250 人、一人一機的公司家庭日答題遊戲，三回合約 20 分鐘。成人與兒童以手機瀏覽器參與，主持人控制進度，投影幕顯示題目與排名。

## 多人 MVP 與現場控場

- 輸入暱稱加入同一活動房間。同名由伺服器加四位亂數編號，再檢查唯一性。
- 主持人手動開始、公布答案並計分、進入下一題／回合及結束遊戲。
- 可暫停／恢復原題；已收到的答案保留，未確認的手機答案等恢復後重送。
- 可附理由跳題：先預覽確認，整題不計分、不公布正解，再手動下一題。
- 可附理由補分／扣分：先預覽前後分數再確認，重試不重複加分；不接受負總分。登記決勝名次後禁止改分。
- 操作回覆遺失時，控制台提供獨立「重試上次操作」並暫停其他變更，避免錯誤重做。
- 玩家每題送出一次答案，伺服器持久化接收後才顯示「已收到」。重送回傳原接收結果。
- 主持人公布前不傳正解；公布後停止接受新答案。答對固定 260 分，錯答／未作答 0 分，沒有速度加成或自動倒數。
- 三回合各三題，目前是示範題庫。個人分數累積，同分並列，不以回答時間排序。投影結束時顯示前 10 位，手機與主持人可看完整排行。
- 遊戲結束後主持人登記上台決勝名次，保留原積分。
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
scripts/prepare-assets.js  將 QR Code 套件複製到靜態資產，無外部 CDN 依賴
dist/index.html          玩家頁面（/）
dist/host.html           主持人控制台
dist/screen.html         只讀投影畫面
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

`ROOM_CODE` 預設為 `family-day`。一個房間只能進行一次活動，尚未提供清場／重置；彩排或另一場活動應更換房間代碼。玩家身份保存在 localStorage，主持人登入保存在 sessionStorage；手機清除瀏覽器資料、換瀏覽器或換機將無法恢復原玩家，需工作人員處理。此階段沒有員工名單核身，不能技術上保證一個人只建立一個身份。

## 驗證

已安裝專案依賴及 Playwright Chromium 時，可一鍵執行完整本機驗收：

```sh
npm run acceptance
```

驗收使用公開測試 fixture，不使用實際帳號／金鑰。若專案內已有 `.env`／`.dev.vars`，會拒絕啟動本機整合驗收，請使用沒有實際環境檔的專案副本；不需刪除或搬動原設定。所有測試資料、log、截圖與 dry-run 產物保存在 `.test-artifacts/`，不自動刪除，也不提交 Git。最新結果路徑保存在 `.test-artifacts/latest-acceptance.json`。

個別驗收：

```sh
npm test
npm run test:controls
npm run test:controls:browser
npm run test:integration
npm run check
```

- 規則測試：暱稱去重、答案與主持人指令去重、固定計分、同分並列、三回合及 350 人容量。
- 整合測試：啟動隔離本機 Worker／DO／D1，350 玩家及 WebSocket 連線、集中提交、揭曉、重連、匯出、整個服務重啟後恢復，以及 D1 暫時無法使用後的封存補寫。測試設定及資料保留在專案 .test-artifacts/，不使用雲端資源。
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

開發計畫、實際驗收結果與接手資訊見 `PROGRESS.md`，規則取捨見 `DECISIONS.md`。本輪只建立本機 branch／commit，尚未推送或部署。
