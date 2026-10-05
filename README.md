# 家庭日｜全員出動

公司家庭日手機網頁小遊戲，目標約250人各自參加、三回合約20分鐘。

## 目前狀態

A版核心功能已完成：Cloudflare Workers、SQLite Durable Objects、D1；B2保留替代方案。已有題庫後台、主持人控制、多人同步、伺服器計分、重連、成績歸檔與CSV。HTTPS Staging及自動驗收已通過，使用者已開始手機試玩。

目前是測試環境，使用人機驗證測試金鑰，只放測試題與暱稱。真正Turnstile、350條連線壓測、正式環境與現場彩排仍待完成。

- [題庫後台](https://family-day-game-staging.ompstw.workers.dev/?admin)
- [主持人入口](https://family-day-game-staging.ompstw.workers.dev/?host)
- [成績後台](https://family-day-game-staging.ompstw.workers.dev/?results)
- [開發計畫與下一步](docs/開發計畫與下一步-2026-10-05.md)
- [開發與測試](docs/milestone-1/開發與測試.md)
- [HTTPS部署與驗收](docs/milestone-1/HTTPS測試部署.md)

## 本機開發

安裝Node.js 22.18以上（建議24），執行 `npm ci`，將 `.dev.vars.example` 複製為 `.dev.vars` 並設定隨機管理密碼，再執行 `npm run dev`。詳細測試指令見開發文件。

## Prototype

原始前端Prototype保留於 `dist/index.html`，可直接開啟預覽；正式前端建置於 `apps/web/build/`，不覆蓋Prototype。

## 下一步

優先完成350條WebSocket壓測與共用IP加入限流驗證，再進行真正Turnstile／跨裝置驗收、主持人備援、正式環境與三回合彩排。題庫發布歷史、角色分權及其他任務功能依後續需求安排。
