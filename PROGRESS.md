# 開發進度｜2026-10-16

## 本輪目標

正式題庫 Excel 匯入、驗證／預覽／確認發布，以及主持人建立新場次、保留歷史、舊手機重新加入。不更改使用者的 Cloudflare 設定或實際金鑰、不刪檔、不推送或部署。前輪 M0～M3 控場功能已完成，本輪計畫與驗收為下方 M4～M7。

## 計畫與驗收（先於實作）

| 里程碑 | 實作範圍 | 必須實際執行的驗收 |
|---|---|---|
| M0 開發護欄 | 所有驗收資料與 build 產物留在專案 .test-artifacts/；保留測試資料、不刪檔；建立決策紀錄 | 現有規則、350 玩家整合、D1 恢復、瀏覽器與 dry-run；驗收入口不使用 /tmp 或 rm |
| M1 主持人規則 | 暫停保留答案並暫拒新答案；恢復原題；跳題封題、全員零分、不公布正解；補扣分驗證與操作去重 | 新增 controls.test.js 先得到預期失敗，再實作至通過；原規則測試仍通過；真 Worker API 驗證權限、重複／過期指令、重啟恢復及匯出紀錄 |
| M2 現場操作介面 | 三畫面同步暫停／跳題；補扣分及跳題先預覽確認；失敗使用原指令重試；保留手機待送答案 | 新增獨立瀏覽器驗收；原瀏覽器驗收保留；320/390 寬度、離線暫停恢復、確認取消、多主持人競爭及結果同步 |
| M3 自我審查與交付 | 審查邏輯、邊界、可讀性、手機體驗及限制；更新文件 | 全套驗收實際通過、git diff --check；紀錄結果與已知限制後 commit |

## 狀態

- 已完成：M0～M7；本輪 Excel 題庫、可變題數、主持人新場、歷史下載、線上／離線舊玩家重新加入及自我審查修正。
- 進行中：無。
- 下一步：使用者審查新功能後，再授權推送此分支、更新測試站並用正式題庫彩排；仍待身份人工復原及現場監控。
- 卡點：無程式卡點。本輪沒有更新正在使用的 Cloudflare 網站。
- 目前分支：本機 `feat/question-bank-and-sessions`，基於 `7196a9d`。本輪新功能尚未推送或部署，既有遠端控場分支不受影響。

## 測試入口

- npm test：現有規則測試（之後擴展至所有 *.test.js）。
- npm run test:integration：隔離本機 Workers／DO／D1，350 位玩家、封存失敗及恢復。
- npm run test:browser：既有多畫面／離線流程。
- npm run check：只做 Worker bundle dry-run，不部署。
- 每個驗收紀錄需包含命令、結果、失敗根因（若有）。同一錯誤連續三次失敗會換方法，不刪除／放寬測試。

## 尚未完成的現場條件

真實 iPhone／Android、真實行動網路、已部署平台壓力測試、正式題庫／活動節奏及身份遺失人工復原不屬於已驗證範圍。本次控場分支推送已獲授權；部署仍須另外獲授權。

## 驗收紀錄

### M0 基線

- 實際執行：npm test、npm run test:integration、npm run test:browser、npm run check、git diff --check。
- 結果：全部通過。現有 5 項規則測試、350 玩家／WebSocket、D1 失敗補寫、服務重啟與 Chromium 離線流程均通過。
- 護欄：驗收檔案／截圖及 build 在專案 .test-artifacts/；不刪測試資料。沒有安裝套件或外部推送／部署。

### M1 預期失敗（RED）

- 實際執行：node --test tests/controls.test.js（輸出保留於 .test-artifacts/controls-red.log）。
- 結果：9 項中 8 失敗、1 通過。根因均為目前 command() 不支援新控場操作，符合先測試再實作的預期；沒有修改／刪除測試来迴避。
- 失敗次數：此錯誤第一次執行，沒有連續三次重試。
- 下一步：完成規則並跑全部單元測試與真 Worker API 驗收。

### M1 規則 GREEN

- 實際執行：npm test。
- 結果：14/14 通過（新增 9 項控場規則＋原 5 項規則）。
- 實作：暫停／恢復、跳題／最後一題不洩漏正解、補扣分稽核與內容指紋去重；不改舊測試期待值。
- 進行中：真 Worker API 控場驗收，及既有整合回歸。

### M1 整合驗收

- 實際執行：npm run test:controls、npm run test:integration、git diff --check。
- 結果：全部通過；暫停狀態服務重啟、答案保留、423、權限、重試指紋、過期控制台、補扣分前後紀錄、最後跳題及決勝名次保護均验證。原 350 玩家與 D1 失敗恢復亦通過。
- M1 完成，準備獨立瀏覽器驗收；沒有放寬／刪除既有測試。

### M2 預期失敗（RED）

- 實際執行：node tests/controls-browser.js（.test-artifacts/controls-browser-red.log）。
- 結果：等待 #pauseBtn 超時；根因是介面尚未提供暫停按鈕，符合先驗收再實作。只執行一次，未修改測試期待值。
- 下一步：接上控場按鈕、確認預覽與獨立重試，再完整執行此驗收及既有瀏覽器回歸。

### M2 GREEN 與回歸

- 實際執行：npm run test:controls:browser、npm run test:browser、npm test、git diff --check。
- 結果：新控場驗收、既有 Chromium 多畫面／離線流程及 14 項規則全部通過。
- 實際模擬：玩家離線待送答案跨暫停／恢復；跳題／補分確認取消；另一主持人使預覽過期；伺服器已加分但 POST 回覆被中斷，使用同一 commandId 重試且僅有一筆補分紀錄。
- 手機 320／390 像素沒有水平溢出。已視覺檢查 .test-artifacts/host-controls/ 中的暫停與跳題截圖。

### M3 自我審查（待修正）

- 邏輯與邊界：已檢查暫停收題、最後跳題、錯誤理由／分值、多控制台 stale revision、重複補分、分數調整後決勝名次不可過期。
- 可讀性：主持人表單渲染拆成命名 helper，沒有引入額外框架或套件。
- 發現：舊 WebSocket 遲到回呼可能影響新連線；成功補分後表單仍留有舊數值；手機主持人頁的 QR Code 佔用控場空間。
- 下一步：舊 socket 回呼忽略、成功補分清空輸入、開始後收合 QR 區塊；補弱網切換驗收，再跑完整 acceptance。

### M3 修正與驗收安排

- 修正舊 socket 遲到回呼，成功補分後清空數值／理由，開始後收合可再展開的 QR 區塊。
- 已實際執行擴充的 npm run test:controls:browser：通過。驗證補分成功輸入清空，以及三次快速離線／上線後身份與分數仍保持。
- 原測試保留；新增弱網切換斷言，沒有刪除或放寬驗收。
- 已完成README與多人開發文件更新；準備 npm run acceptance 以全套串行命令產生實際結果報告。
- 下一步：讀取全套結果、最後自我審查、更新進度與 commit。

### M3 全套實際驗收與審查完成

- 實際執行：`npm run acceptance`。
- 結果：**PASS 7/7**；14 項規則、控場 API、350 玩家／WebSocket 與 D1 故障／服務重啟恢復、原瀏覽器、新控場瀏覽器、Worker dry-run、diff 檢查全部退出碼 0。
- 報告：`.test-artifacts/acceptance-TIaK5N/RESULTS.md`；每條命令的 log 保留在同一資料夾。最新路徑另保存於 `.test-artifacts/latest-acceptance.json`。
- 失敗策略：只有先寫測試時的兩次預期 RED（缺規則、缺按鈕），沒有發生同錯誤連續三次實作失敗；未改掉或刪除測試以求通過。
- 最後自我審查：邏輯、最後一題／零分／無效值、過期 revision／指令指紋、弱網待送答案、多主持人、回覆遺失、資料恢復及不洩漏正解均有執行驗收；手機畫面已查看截圖，沒有水平溢出。
- 可讀性與限制：沿用原 Workers／DO／D1，沒有新增框架或依賴；原 prototype 保留。CLI／驗收產物在專案內保留，沒有刪檔、實際金鑰讀寫、套件安裝、外部推送或部署。
- 已知限制：Chromium 模擬不代表 iPhone／Android 實機；本機 350 連線不代表正式網路容量。已登記決勝名次後拒絕改積分；身份人工恢復、正式題庫、監控與現場彩排仍待處理。

## 接手方式

1. 先讀本檔與 DECISIONS.md；確認 `git status`、本機分支與最近 commit。
2. 使用已安裝依賴執行 `npm run acceptance`；測試資料保留，不刪除。若已有真實 .env／.dev.vars，使用無實際環境檔的專案副本，不讀／搬動金鑰。
3. 後續仍採先寫計畫與驗收、小步實作、實際測試、自我審查與里程碑 commit。
4. 控場分支已依使用者指示推送；部署、合併 main、建立雲端資源仍未授權，不要直接執行。

## 2026-10-15 GitHub 測試交接

- 使用者明確要求先推送 GitHub，再自行測試；本節取代先前「尚未推送」的狀態描述。
- 四個開發 commit 已發布至 `feat/event-host-controls`。遠端程式 tree `57ef3c080850149ba067fdb0d99f02fd51854058` 與通過 PASS 7/7 驗收的本機 tree 完全相同。
- 已以 GitHub 讀取回驗分支指向與程式 tree；main 仍為 `8af0dda`，沒有合併、部署或建立雲端資源。
- 另補一筆文件交接 commit，更新本檔、DECISIONS.md 與 README；不變更程式。
- 測試者請下載／切換 `feat/event-host-controls`，依 README 啟動或執行 `npm run acceptance`。GitHub 原始碼頁並不是可直接遊玩的網站。

## 2026-10-16｜Excel 題庫與新場次（本輪進行中）

- 目標：主持人下載 .xlsx 範本、匯入／驗證／預覽正式題庫；不改 ROOM_CODE 即可建立新場次。
- M4 計畫與先行驗收：先新增規則測試，驗證三回合可變題數、無效題庫拒絕、未開始才可匯入、新場次清空當場分數但保留舊資料、重送不多開一場。
- M5 後端：將題庫固定保存於當場，擴展主持人操作；單一既有 DO 保留多場歷史，以 sessionId 隔離答案，version／revision 持續遞增；不新增雲端 binding／資料庫 migration。
- M6 前端與 Excel：下載真實 Excel 範本；背景解析 .xlsx、逐列錯誤、確認後發布；新場次確認、舊手機提示重新加入、歷史場次下載。
- M7 實際整合與瀏覽器驗收：匯入後完整三回合、非三題回合、格式錯誤／開始後拒絕、重新整理與服務重啟、新場次重試、離線舊答案不計分、歷史分數與題庫保留；全部舊驗收回歸。
- 依賴：只評估官方 npm 的已知開源 Excel 讀取套件，鎖定版本；現有 openpyxl 產生範本與測試檔，不安裝其他 Python 套件。
- 安全邊界：只在專案內操作；不讀寫實際金鑰、不刪檔、不推送或部署；所有驗收資料保留 .test-artifacts/。
- 目前：已檢查乾淨工作目錄與既有架構；正在補規則及驗收。
- 下一步：先執行新規則測試取得預期 RED，再小步實作與 commit。

### M4／M5 實際驗收進度

- 規則 RED：新增 question-bank-sessions.test.js，實際失敗為 shared/question-bank.js 尚不存在；只執行一次，紀錄在 .test-artifacts/bank-sessions-red.log。
- API RED：新增 bank-sessions-integration.js，實際失敗為 import-bank 缺少伺服器 digest；未刪除或修改驗收期待值，紀錄在 .test-artifacts/bank-sessions-api-red.log。
- 規則 GREEN：npm test 20/20 通過，包含原 14 項及新增 6 項。
- 新 API GREEN：實際通過權限、SHA-256 題庫指紋、可變題數、開始鎖定、服務重啟、新場次重送、舊資料匯出及舊答案隔離。
- 已驗證新依賴來源：read-excel-file 9.3.12，MIT，官方 npm 指向 catamphetamine/read-excel-file，版本已鎖定；沒有讀取實際金鑰。
- 下一步：跑舊整合回歸並提交後端里程碑，再做 Excel 背景解析與主持人表單。

### M5 後端里程碑完成

- 實際執行 npm run test:controls、npm run test:integration、git diff --check：全部通過；原 350 人、D1 故障、重啟與控場功能未退化。
- 新場題庫獨立持久化，舊場 players／answers／bank 在同一 DO transaction 保存；D1 事件用 sessionId 篩選，不改既有 schema。
- 本輪下一步：M6 Excel 真實範本、受限背景解析與主持人新場介面；M7 全套回歸仍未完成，不宣稱交付。

### M6 瀏覽器驗收與修正

- 已實際執行真實 .xlsx 範本解碼／ZIP 限制單元測試：總計 22/22 通過。
- 瀏覽器 RED：第一次缺少 #bankFile（預期缺介面）；接上介面後，真實匯入到新場切換均通過，但歷史下載按鈕在收合區塊內而無法點擊。
- 根因：historyPanel 是預設收合 details，非歷史資料遺失；修正為有歷史時自動展開，不改驗收期待值。
- 自我審查追加：離線手機跨新場重連收到新場提示；連線數排除舊場身份；舊版指令指紋缺新增欄位時以 null 相容，不重複執行。
- 目前正在重跑新瀏覽器驗收；沒有同錯誤連續三次失敗。

### M6 前端與 Excel 里程碑完成

- 實際執行：npm run test:bank-sessions:browser、npm run test:browser、npm run test:controls:browser、npm test、git diff --check，全數通過。
- 單元測試目前 23/23。真實 .xlsx 使用已提交的公開示範 fixtures，不需要測試者重新產生檔案。
- 瀏覽器驗證已涵蓋範本下載、逐列錯誤、確認取消、4 題分成 2／1／1 三回合、開始後鎖定、新場回覆遺失後同 ID 重試、舊場下載、在線／離線手機重新加入、分數歸零。
- 介面：開局後收合題庫／QR 區塊；遊戲中隱藏新場表單，長題目與選項自動換行。
- 下一步：M7 自我審查與 npm run acceptance 完整執行，確認 350 人與封存恢復仍正常；尚未推送或部署。

### M7 自我審查新增邊界與修正

- 第一輪完整 acceptance 曾通過 9/9；但審查另發現正解空白／AB 會被 JavaScript indexOf 誤轉為 A，不能以該輪結果作最終交付。
- 已先新增並實際執行回歸測試，得到預期失敗（.test-artifacts/bank-answer-edge-red.log），沒有刪改原測試以求通過。
- 修正為嚴格單一 A～D；null、空白、AB、ABC、BCD、數字均拒絕。一般數字選項轉成顯示文字，日期／百分比／前導零仍請使用文字。
- 新增真實 Excel 空白正解與數字選項 fixtures，單元與瀏覽器都會驗證；準備重跑完整 acceptance。
- 其他審查：歷史依結束順序排列、發布後清空檔案選擇、單值儲存大小受限、題庫不得公開或開局後被替換。

### M7 最終驗收與交付

- 最終實際執行 `npm run acceptance`：**PASS 9/9**，26 項單元測試、題庫／場次 API、真實 XLSX 瀏覽器、原控場 API、350 玩家與 D1 恢復、原兩套瀏覽器、Worker dry-run、diff 檢查全部通過。
- 最終報告：`.test-artifacts/acceptance-cEju9z/RESULTS.md`。此報告涵蓋空白正解、AB、數字選項修正；前一輪報告不作最終證明。
- 自我審查完成：JSON 請求串流上限、ZIP 邊界、背景解析時限、舊版指紋與 legacy 場次相容、題庫逐場保存、D1 事件隔離、新場回覆遺失重試、離線舊玩家、新題目 ID、開始後鎖定與長字串換行。
- 已查看 .test-artifacts/bank-sessions-browser/host.png，320／390 手機與 1280 投影測試通過，沒有水平溢出。
- 原 prototype 檔案保留不變；沒有新增 Cloudflare binding 或 D1 migration，不必改 ROOM_CODE 或重設 HOST_KEY。
- 本輪沒有同錯誤連續失敗三次；有先寫測試的預期 RED 與一次歷史下載收合問題，皆讀取根因後修正；沒有刪除／放寬測試來通過。
- 已知限制：僅支援範本 .xlsx、三回合各 1～20 題、固定 260 分，不能中途換題庫或覆蓋進行中的場。正式題庫不應提交公開 repo；仍須部署後以真實手機／行動網路彩排。
- 使用方式見 docs/Excel題庫與場次操作.md；可先下載 dist/question-bank-template.xlsx 開始備題。

### M8｜24 題公開測試題庫（進行中）

- 計畫：沿用既有 Excel 範本，另存一份測試題庫，不變更遊戲程式或原範本。三回合各 8 題，主題為生活、動物自然、簡單動腦，適合成人與兒童。
- 驗收腳本：使用專案實際採用的 read-excel-file/universal 讀取「題庫」，執行 ZIP 檢查及 normalizeWorkbookRows；斷言 24 題、回合各 8 題、每個答案字母 6 題、題目不重複；另以遊戲核心跑完 24 題確認累計分數。
- 自我審查：正解唯一、題意清楚、無時效資訊與公司私密資料、不含公式；確認原範本未修改。
- 下一步：產出 Excel、執行驗收、記錄結果並提交一個小 commit；不推送或部署。
- 卡點：無。

### M8｜24 題公開測試題庫完成

- 已完成：dist/question-bank-test-24.xlsx；生活小高手／動物自然王／歡樂動腦題各 8 題，保留原範本的欄位、格式、下拉驗證與填寫說明，另附主持人答案與解說。可用 scripts/generate-test-bank.py 重新產生。
- 實際驗收：以 read-excel-file/universal（與瀏覽器相同入口）讀取真實 Excel，通過 ZIP 檢查及 normalizeWorkbookRows；24 題不重複、每回合 8 題、A～D 各 6 題、主持答案與所有題目一致。
- 實際執行 7 位玩家的 24 題核心流程：全對 6240／全錯 0／未作答 0／固定選 A、B、C、D 各 1560 分；三回合順序、題號、結束狀態與重送答案不重複計分均通過。結果存 .test-artifacts/test-bank-24/RESULTS.txt。
- 另已實際驗證：題庫工作表 25 列（含標題）、所有工作表無公式、檔案小於 2 MiB、原範本與 HEAD 完全一致。
- 自我審查：題意與正解唯一性已逐題核對，未放入公司私密或時效資訊；測試題偏簡單，供流程彩排，並非正式競賽難度設計。未變更遊戲程式，因此未重跑與本次內容無關的全套容量測試。
- 已知限制：本次是實際解析器及核心流程驗證，不宣稱已完成線上匯入或正式環境容量測試。Excel 含正解，僅提供主持人保管。
- 下一步：下載此檔，於支援 Excel 匯入的主持人頁面，開始前匯入、預覽並發布；新增功能仍待推送與部署。卡點：無。

### M9｜授權部署（進行中）

- 使用者已於 2026-10-17 授權部署。計畫：重新執行完整 acceptance、確認 Cloudflare 身分與既有設定，發布已驗收分支，部署後唯讀檢查公開頁面與題庫下載。
- 驗收：npm run acceptance 全數通過；GitHub 遠端檔案樹與本機一致；正式網址提供新版主持人頁面、Excel parser 與 24 題檔案。
- 保護：不重設 HOST_KEY，不建立付費訂閱，不清空場次、不覆寫未知的 ROOM_CODE；沒有部署權限時如實記錄並提供可執行交接。

### M9｜部署前驗收完成，Cloudflare 身分卡點

- 實際重跑 npm run acceptance：PASS 9/9；報告 .test-artifacts/acceptance-DjVrvV/RESULTS.md。包含 26 項單元、Excel／場次 API 與瀏覽器、控場、350 玩家與 D1 恢復、既有瀏覽器、dry-run 及 diff 檢查。
- Cloudflare 身分檢查：wrangler whoami 明確回覆「You are not authenticated」；環境 readiness 亦無 Cloudflare 身分或 secret 綁定。沒有登入或使用臨時帳戶部署，也未讀取或改寫登入碼。
- GitHub 發布準備曾受 git pager 污染輸出而解析失敗；改用 git --no-pager 並逐 commit 讀取，核對四個里程碑的本機 tree SHA，避免遺漏提交。此為發布資料準備問題，非測試失敗。
- 已補上 Windows PowerShell 部署步驟（docs/Excel題庫與場次操作.md），保留使用者本機 D1 ID，使用 --keep-vars 保留線上 ROOM_CODE；不需要 HOST_KEY 重設或 D1 migration。
- 進行中：發布 feat/question-bank-and-sessions 並核對遠端 tree；下一步須由已登入的使用者電腦執行 wrangler deploy --keep-vars，再驗證新版正式頁面。不得將 GitHub 發布宣稱為正式網站部署完成。

### M9｜GitHub 發布完成；正式網站尚待使用者電腦部署

- 已將五個小提交發布到 GitHub feat/question-bank-and-sessions；發布頭為 2f175ccc8077d9e22ae1c8abbd61f3cd80ca6d4f，逐提交核對 Git tree。遠端 fetch 後完整檔案樹與已驗收本機一致（4f049c24c31e9d5c9312755664e457a443c4fb1e），git diff --exit-code 通過。
- 發布核對發現 package-lock.json 的 CRLF 會被文字傳輸正規化，已改用 base64 blob 保存原始 bytes；重建後 tree 完全相同。新分支不存在時 update_ref 回覆 422，已改用 create_branch，沒有強制覆寫任何既有遠端分支。
- 本機以相同檔案樹對齊遠端 GitData 產生的提交中繼資料並設定 upstream，無檔案遺失；後續可正常 fast-forward 續接。
- 最後補齊 README 發布狀態與明確 fetch refspec，避免只抓取舊分支的 clone 找不到新分支。本段文件更新不變更已驗收程式與 Excel。
- 完成：Excel／新場次／24 題測試檔發布、9/9 完整本機驗收、Windows 部署操作文件。
- 卡點：wrangler whoami 未登入；正式 Worker 尚未部署本次更新，亦未執行線上匯入、建立新場或容量測試。
- 使用方式：在已登入 Cloudflare 的既有專案執行 docs/Excel題庫與場次操作.md 的命令；保留實際 DB ID、ROOM_CODE、HOST_KEY。部署完成後全部裝置重新整理，主持人再匯入 dist/question-bank-test-24.xlsx。
