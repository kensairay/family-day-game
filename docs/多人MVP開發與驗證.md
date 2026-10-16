# 多人 MVP、題庫與控場｜2026-10-16

## 規則

一人一機、不分隊。玩家暱稱重複時由伺服器加亂數編號；一題只接受一次答案。主持人公布前只確認收到，不提前判分／公布正解。公布答案即停止收題，答對固定加分、答錯與未作答 0 分。三回合累積個人積分，同分並列，上台決勝另登記最終名次。

新增 import-bank（只允許 waiting）與 new-session（finished 或空 waiting）指令，均帶 commandId／revision 防重複；匯入內容的 SHA-256 由伺服器產生，不信任前端 digest。

控場規則：

- pause：只允許 open → paused，保留答案。新答案暫拒（423）；已收答案重送仍回原收據。
- resume：paused → open，恢復原題；手機重送待確認答案。
- skip：open／paused → skipped，必填理由，整題零分，不立即換題、不揭曉正解。
- next：revealed／skipped → 下一題，最後一題則 finished。
- adjust-score：paused／revealed／skipped／finished 可補扣分；需玩家 ID、非零整數 delta 與理由，記錄 before／delta／after；結果不得為負。已有決勝名次時拒絕。
- 跳題及補扣分先顯示確認預覽，使用預覽當時的 revision；另一主持人改了進度就拒絕，不自動重套新進度。

此版本不自動倒數。活動節奏由主持人掌握，內建三回合各三題僅是示範題庫；Excel 可發布三回合各 1～20 題。

## 資料與 API

- 一個 ROOM_CODE 對應一個 Durable Object。它序列化房間請求，持久化 meta、players、當題 answers 與事件 outbox，寫入成功後才回覆。
- ROOM_CODE 對應活動服務；同一 DO 內用 sessionId 區分場次。主持人建立新場時，交易內保存舊場題庫／去憑證玩家／答案，再切換新的空場；不刪除舊紀錄。
- 每次主持人操作帶 commandId 與 revision。重試相同指令不再次執行，過期控制台操作被拒絕；開始／收题／換題的合法階段也由伺服器檢查。
- 玩家憑證由手機預先產生並保存。加入回覆遺失仍可用原憑證重試，同一玩家不被重建。暱稱不能用來登入或找回身份。
- 答案帶 questionId，首次接收即鎖定；重送只回覆原收據，不得改答案。收题後未送達的答案不被接受，不承諾離線作答能得分。
- 前端 WebSocket 使用首則 auth 訊息，不把登入碼／玩家憑證放在 URL。支援 heartbeat、自動重連、前景狀態同步與 HTTP 快照；待送答案在重新連線後重試。
- 玩家不收到他人的答案或身份憑證。正解只在已揭曉且未作廢的 revealed／finished 傳送；跳過最後一題也不會洩漏其正解。參加者暱稱與分數是公開排行榜內容。
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
| GET sessions | 主持人取得過去與目前場次清單 |
| GET export?sessionId=… | 主持人取得指定場次紀錄，省略參數則目前場次 |
| GET ws | WebSocket，先驗證角色，之後接收快照 |

只有設定的 ROOM_CODE 可存取。此核心限制 350 玩家與 400 WebSocket，連線中人數為玩家身份去重後的連線數，斷線偵測可能有延遲。

## 測試與已知限制

`npm run acceptance` 實際串行執行規則、控場 API、350 玩家／D1、既有瀏覽器、控場瀏覽器、dry-run 與 diff 檢查。紀錄保留於專案 .test-artifacts/；詳見 README 與 PROGRESS.md。測試環境是 Miniflare/workerd；不能用本機耗時推估現場網路或 Cloudflare 地區延遲，也不能視為已完成正式 350 人壓力測試。

首次活動前需補足：

- 正式題庫審核、每回合節奏與 20 分鐘彩排。
- 真實 iPhone Safari／Android Chrome、行動網路、鎖屏、網路切換及集中重連。
- 遺失玩家身份的人工處理；暫停／跳題與手動補扣分已在本機驗證。
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

## Excel 與場次資料

- 正式題庫保存在每場的 DO bank key，不需提交至 Git；舊場 bank 與分數保存為分開的 history keys，避免單一 value 過大。
- 題庫標準化 JSON 上限 96 KiB；主持人 JSON 請求以串流限制 128 KiB，其他請求仍為 4 KiB。
- 新場 version／revision 持續遞增，command receipts 不清空；新場題目 ID 帶 sessionId，舊憑證失效、舊答案不能計入新場。
- 舊版無 sessionId 的資料視為 legacy；既有 D1 事件沒有 sessionId 時仍可在 legacy 歷史匯出。無新增 D1 migration 或 DO binding。
- 活動事件皆加 sessionId 封存。建立新場不清空 outbox，D1 暫時失敗仍可恢復補寫。
- .xlsx 原檔僅在主持人的 Web Worker 解析，驗證後只傳題庫 JSON；不載入外部 CDN、不執行 Excel 公式。巨集／加密／.xls 不支援。
