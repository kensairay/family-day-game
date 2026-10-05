# HTTPS 測試部署與自動驗收

更新：2026-10-05。A版；Cloudflare部署授權已設定，已建立獨立Staging Worker、Durable Objects與D1並套用兩份migration。測試網址為 https://family-day-game-staging.ompstw.workers.dev 。各版本的遠端驗收結果以GitHub Actions摘要為準；部署成功不等於全部驗收通過。

本次遠端驗收於2026-10-05 13:47（台北時間）全部通過。部署程式版本為 `b52636aef77df48dab2393253111f8fe75b79675`，Worker版本為 `0cda1da2-ebc7-40a7-83ae-87555035432f`。[GitHub Actions驗收紀錄](https://github.com/kensairay/family-day-game/actions/runs/37269146690)的acceptance與staging兩項工作均成功，JSON驗收報告保存至2026-10-12。真實手機、正式Turnstile及350連線壓測仍待執行。

後續更新：2026-10-05 14:04，手機試玩回報的測試程式文字已修正，部署程式版本為 `06635094e4f1fed8fba89adc5384279275cf2ba5`，[最新自動驗收](https://github.com/kensairay/family-day-game/actions/runs/37270392964)全部通過。使用者已開始手機實測；完整跨裝置、正式Turnstile及350連線驗收仍待完成。下一步見 [開發計畫](../開發計畫與下一步-2026-10-05.md)。

## 主持人連線修正（2026-10-05）

使用者回報新房間建立後停在「讀取房間狀態中」，截圖同時顯示連線中斷。可以確認未收到房間快照；沒有使用者瀏覽器的Console／Network記錄，無法斷定該次握手被CSP、現場網路或其他環境因素阻擋。

修正程式版本：`7c1b99f10fae9c119d0a06e3357dcb04639eadca`。[本次驗收](https://github.com/kensairay/family-day-game/actions/runs/37285972064)。

- CSP明確允許本站的`wss://`（本機為`ws://`並保留port），不開放任意WebSocket站台。MDN說明部分瀏覽器不會將`connect-src 'self'`視為允許WebSocket：[connect-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src)。
- 修正握手失敗時`connectedAt=0`讓重試預算持續重設的錯誤。最多重試五次；必須成功連線、收到快照且穩定超過一分鐘，才重設預算。
- 十秒內未建立連線或取得初始快照會進入恢復流程；只有收到快照才開放遊戲控制。初始讀取文字會隨連線狀態更新。
- 握手失敗時透過同來源HTTPS的`POST /api/rooms/:id/connection`檢查房間與憑證。必須有原本的主持人／玩家憑證，且保留Origin、HTTPS、房間存在與IP限流；不洩漏題庫、答案或玩家資料，不取代現有工作階段、不啟用玩家、不延長租約。
- 房間不存在／到期、憑證失效、尚未完成加入、來源錯誤、限流會明確顯示並停止重試。房間與身分有效但即時連線仍失敗時，提示在同分頁換網路後重新整理。
- 不修改使用者題庫、既有房間的題目快照或Prototype。沒有HTTP輪詢遊戲替代路徑；若現場網路封鎖WebSocket，仍需換網路或調整該網路設定。

本機型別、建置、17項單元測試、遊戲／題庫／D1歸檔／HTTPS安全整合測試通過。GitHub隔離瀏覽器驗收通過，包含Chromium及WebKit的六題、三回合、主持人開始／重載、玩家600分及D1歸檔，另模擬握手中斷並確認錯誤文字取代初始讀取狀態。遠端HTTPS驗收於2026-10-05 16:52:54（台北時間）全部通過；部署於16:52:12完成。本次acceptance與staging兩項工作均成功。真實裝置及使用者現場網路仍需確認。

## 你需要完成的一次設定

這一段需要你的帳號操作；API Token和密碼請只存進GitHub Secrets，不要貼在對話或提交程式碼。

1. 登入Cloudflare，開啟 **Workers & Pages**，確認 **Your subdomain** 已設定。測試使用workers.dev，不需要先買網域或調整DNS。部署程式只讀取子網域，不會替你改整個帳號的子網域名稱。
2. 取得Account ID：在Cloudflare搜尋列輸入 **Copy account ID**，或從Workers & Pages的Account Details複製。這是32位英數識別碼，不是登入Email。
3. 建立Cloudflare API Token。依Cloudflare目前的CI文件，可從 **Account API tokens → Create Token → Edit Cloudflare Workers** 範本開始，限制在你要部署的帳號，另外加入D1寫入權限（介面可能顯示 **Account / D1 / Edit**）。本流程需要建立Worker、建立／查詢D1、套用D1 migration及部署程式；不需要設定DNS或正式網域路由。如果介面採新版Workers角色，首次建立Worker需要 **Workers產品層級Admin**；只有Editor不能建立新Worker，建立後可再收斂到單一Worker的Editor。
4. 到 [family-day-game 的 Actions Secrets](https://github.com/kensairay/family-day-game/settings/secrets/actions)，選 **New repository secret**，依下表新增三項。若你習慣Environment secrets，也可放在名為staging的GitHub Environment。

| Name | Value |
|---|---|
| CLOUDFLARE_ACCOUNT_ID | 第2步取得的Account ID |
| CLOUDFLARE_API_TOKEN | 第3步建立的API Token |
| STAGING_ADMIN_SECRET | 你自訂的測試後台密碼，至少24字元，不可使用範例密碼 |

設定完成後回覆「已設定」，便可接續執行Staging部署工作。如果你想自己啟動，在 [Actions](https://github.com/kensairay/family-day-game/actions) 開啟最新的 **Milestone 1 isolated acceptance**，選 **Re-run all jobs**。不要只重跑failed jobs：缺少連線的工作會明確標示「尚未部署」，不會故意讓本機驗收變成失敗。

若遇到GitHub Environment人工核准設定，工作會等待你核准；不是程式部署卡住。未設定secrets時不會呼叫Cloudflare建立資源。

## 自動流程會做什麼

1. 在GitHub執行型別、17項單元測試、遊戲／題庫／歸檔／HTTPS安全整合測試與三套隔離瀏覽器驗收（Chromium及WebKit），再做Wrangler部署dry-run。
2. 檢查三項連線設定。缺少或格式不符時只顯示缺少的設定名稱，略過實際部署；不輸出秘密值。
3. 讀取帳號workers.dev子網域；建立或重用名稱恰為 **family-day-game-staging** 的D1，填入真正UUID及指定hostname。根目錄wrangler.jsonc的本機設定不會被覆蓋。
4. 在該Staging D1套用0001、0002 migration。已套用的migration不重複執行；沒有DROP或清空資料步驟。
5. 部署 **family-day-game-staging** Worker、獨立的GameRoom／RoomDirectory SQLite Durable Objects及正式前端建置；透過Wrangler secrets-file將後台密碼與程式同一次部署，暫存密碼檔隨後刪除。
6. 輪詢HTTPS設定與部署commit。只有網址、Staging模式及revision吻合才開始遠端自動寫入測試資料。
7. 自動驗收網頁、API、兩位模擬手機玩家完整三回合、成績歸檔／CSV及大廳身分恢復。報告放在Actions摘要，JSON報告保存7天。

流程只在feature/milestone-1-foundation的push或手動重跑執行部署；PR只測試，main不會被此流程部署。部署工作排隊執行，避免另一份部署覆蓋正在驗收的版本。設定好secrets後，此開發分支後續通過驗收的push會更新Staging。

程式不永久刪除成績。自動測試使用新建的E2E題庫及測試暱稱，完成後軟封存自己的測試題庫；測試成績仍會留在Staging D1供檢查。

## 網址與操作

部署成功後，Actions摘要會給出實際網址，形式如下（以下是格式範例，不是已部署網址）：

`https://family-day-game-staging.<你的子網域>.workers.dev`

- 玩家加入：根網址或主持人產生的加入連結。
- 題庫後台：`/?admin`，以STAGING_ADMIN_SECRET登入。
- 主持人：`/?host`，選已發布題庫建立房間。
- 成績後台：`/?results`。

本專案Staging：[測試網址](https://family-day-game-staging.ompstw.workers.dev)。取得網址不代表全部驗收已通過，要一起看Actions的部署與遠端驗收結果。

## 人機驗證測試模式的邊界

手機試玩題目不再包含安全測試程式文字。雲端瀏覽器驗收只在未儲存的草稿預覽測試script文字，發布前會換成一般題目；本機隔離遊戲仍保留完整XSS文字驗收。既有Staging房間若符合舊E2E題庫名稱及完整三題測試資料，對主持人與玩家送出的快照會將題目顯示為「第1題」至「第3題」，不更動儲存的版本、答案、配分或成績。正式及使用者自訂題庫不套用這項相容處理。

Staging使用Cloudflare官方dummy Turnstile金鑰，讓自動瀏覽器穩定測成功／失敗流程。**此模式不能代表真正的人機辨識已通過驗收；Staging僅放測試題、測試暱稱，不放正式題庫或真實參加者資料。**

伺服器只有在以下條件全部符合時接受test模式：DEPLOYMENT_ENV=staging、明確指定的STAGING_HOSTNAME吻合目前請求、hostname符合family-day-game-staging.*.workers.dev、且sitekey／secret為文件中的固定dummy配對。仍須呼叫Siteverify，缺少或驗證失敗的token不能加入。dummy回應的hostname／action是固定測試值，因此只在這個隔離模式免除這兩欄比對；正式模式仍嚴格比對hostname與action=join，並拒絕測試金鑰。

新部署有測試模式標示。管理員仍要登入，Cookie在HTTPS具有Secure／HttpOnly／SameSite=Strict；Origin、請求大小、房間與身分限流、正解公布時機、CSV防護等規則保留。部署設定拒絕正式Worker名稱、正式D1名稱、外部DO script_name與DNS路由；遠端測試目標也拒絕正式網址或含帳密的URL。

## 自動測試與待驗收項目

測試模式除了呼叫Siteverify，還要求token恰為官方測試元件產生的 `XXXX.DUMMY.TOKEN.XXXX`；即使Cloudflare的成功測試金鑰接受任意字串，伺服器也會拒絕其他值。固定token是公開的測試資料，不能作為正式防機器人措施。管理登入的密碼欄與按鈕會等待初始session檢查完成才開放，避免慢速網路的初始401回應清除剛輸入的密碼或取消正在進行的登入。

| 項目 | 自動驗收 |
|---|---|
| HTTPS正常連線、HTTP拒絕或轉HTTPS、CSP／nosniff | 遠端通過 |
| 未登入管理API、跨來源寫入、未知房間拒絕 | 隔離及遠端通過 |
| 草稿手機預覽／發布／多分頁版本衝突／XSS文字 | 隔離及遠端Chromium通過 |
| 兩位320／430 px玩家三回合、重載保留答案、公布前保密、排名／作答明細／CSV | 隔離及遠端Chromium通過 |
| 大廳分頁取代／離線人數、關閉房間後歸檔 | 隔離及遠端Chromium通過 |
| 六題題庫主持人開始／重載、三回合600分、連線失敗提示 | 隔離及遠端Chromium／WebKit通過 |
| 真正Turnstile、iPhone／Android、Safari／Firefox實機、行動網路 | 需另做驗收；本流程不冒充真人解驗證 |
| 350條真實WebSocket／現場共用網路NAT | 另行壓測；350人×60題資料量測試不等於連線壓測 |

若驗收失敗，腳本會將該次結果標為failed，不宣稱Staging已可用，也不自動清空D1或刪除DO。需修正原因後重跑。

## 本機指令與檔案

- `npm run staging:readiness`：只檢查必要連線是否存在／格式，不驗證Token的雲端權限。
- `npm run test:staging`：本機Miniflare模擬HTTPS與Siteverify回應，驗證測試模式的安全限制，不使用Cloudflare帳號。
- `npm run staging:deploy`：需要部署授權；建立／重用Staging D1、migration、部署、保存實際目標。
- `npm run staging:verify`：需要前一步生成的staging-target.generated.json及測試後台密碼；會對該HTTPS Staging建立測試題庫與房間。
- wrangler.staging.json是範本，占位UUID與NOT-CONFIGURED hostname不能直接作為可用部署。實際配置由deploy.mjs產生，不手動複製正式資料庫UUID。
- 所有*.generated.json配置／驗收檔排除git；密碼暫存檔在私有暫存目錄，部署後刪除。原Prototype dist/index.html不變。

參考：[Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)、[Account ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)、[workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)、[Turnstile測試](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)、[Workers權限](https://developers.cloudflare.com/workers/authorization/workers/)、[部署時上傳secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。
