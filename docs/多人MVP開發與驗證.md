# 多人 MVP 核心｜2026-10-14

## 規則

一人一機、不分隊。玩家暱稱重複時由伺服器加亂數編號；一題只接受一次答案。主持人公布前只確認收到，不提前判分／公布正解。公布答案即停止收題，答對固定加分、答錯與未作答 0 分。三回合累積個人積分，同分並列，上台決勝另登記最終名次。

此版本不自動倒數。活動節奏由主持人掌握，三回合各三題僅是示範題庫。

## 資料與 API

- 一個 ROOM_CODE 對應一個 Durable Object。它序列化房間請求，持久化 meta、players、當題 answers 與事件 outbox，寫入成功後才回覆。
- 更換 ROOM_CODE 建立另一個活動，不清除舊活動。此版本沒有危險的公開重置操作。
- 每次主持人操作帶 commandId 與 revision。重試相同指令不再次執行，過期控制台操作被拒絕；開始／收题／換題的合法階段也由伺服器檢查。
- 玩家憑證由手機預先產生並保存。加入回覆遺失仍可用原憑證重試，同一玩家不被重建。暱稱不能用來登入或找回身份。
- 答案帶 questionId，首次接收即鎖定；重送只回覆原收據，不得改答案。收题後未送達的答案不被接受，不承諾離線作答能得分。
- 前端 WebSocket 使用首則 auth 訊息，不把登入碼／玩家憑證放在 URL。支援 heartbeat、自動重連、前景狀態同步與 HTTP 快照；待送答案在重新連線後重試。
- 玩家不收到他人的答案或身份憑證。正解只在 revealed／finished 傳送。參加者暱稱與分數是公開排行榜內容。
- 加入／答案尖峰最多每 500ms 更新主持人及投影的統計，避免每次提交向所有玩家廣播。揭曉／換題才對全體更新。
- DO 資料是權威來源。D1 game_events 以房間＋事件序號為唯一鍵封存暱稱、答案、分數與主持人操作；失敗保留 outbox，由 alarm 重試。D1 中沒有憑證。封存狀態顯示於主持人控制台。

| 路徑（前綴 /api/rooms/:room/） | 用途 |
|---|---|
| POST join | 使用持久玩家憑證加入／恢復 |
| GET state?role=player | Bearer 玩家憑證取得自身快照 |
| GET state?role=host | Bearer HOST_KEY 取得主持人快照 |
| GET state?role=screen | 公開只讀投影快照 |
| POST answer | 玩家送出 questionId、choice |
| POST host | 主持人送出 action、commandId、revision |
| GET export | 主持人取得不含憑證的活動紀錄 JSON |
| GET ws | WebSocket，先驗證角色，之後接收快照 |

只有設定的 ROOM_CODE 可存取。此核心限制 350 玩家與 400 WebSocket，連線中人數為玩家身份去重後的連線數，斷線偵測可能有延遲。

## 測試與已知限制

npm test 與隔離本機整合／瀏覽器測試見 README。測試環境是 Miniflare/workerd；不能用本機耗時推估現場網路或 Cloudflare 地區延遲，也不能視為已完成正式 350 人壓力測試。

首次活動前需補足：

- 正式題庫審核、每回合節奏與 20 分鐘彩排。
- 真實 iPhone Safari／Android Chrome、行動網路、鎖屏、網路切換及集中重連。
- 暫停／跳題、手動補扣分與遺失玩家身份的人工處理。
- 主持人備援設備、QR Code 印刷、紙本／口頭備案。
- 正式環境限流、監控、資料保留／清理政策，及主持人登入碼的保管與更換。

此階段沒有參加者名單核身；「一人一機」是活動規則，清除本機資料仍可重新建立身份。主持人共用登入碼可用於備援設備，但無法區分操作者，操作紀錄只辨識操作，不辨識個人管理員。

## Cloudflare 正式設定準備（尚未執行）

1. 建立 D1，將實際 database_id 填入 wrangler.jsonc。目前全零 ID 是本機 placeholder。
2. 使用 Worker secret 設定 HOST_KEY（至少 16 字元的私密登入碼），不可放在程式／公開 repo／QR Code。
3. 選定正式 ROOM_CODE；套用 D1 migrations。所有 --remote 操作僅在正式發布獲授權時執行。
4. npm ci、npm run prepare:assets、測試與 dry-run 完成後，再依使用者指示部署到 Cloudflare。既有 Sites 設定無法部署 Durable Object。
5. 用實際 HTTPS 位址重新檢查三種畫面與 QR Code，再做已部署平台的容量測試及活動彩排。

題目只存在 src/questions.js（伺服器 bundle）；舊 prototype 留在 prototype/，不部署至 dist/。repository 若保持公開，正式保密題庫仍不應直接提交到公開 repo；目前題目都是示範。
