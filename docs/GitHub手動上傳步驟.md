# 家庭日手機網頁小遊戲｜GitHub 手動上傳步驟

目標 Repository：

https://github.com/kensairay/family-day-game

本文件說明如何使用 GitHub 網頁介面，把目前 prototype 整理後上傳，讓後續可以交給 Codex Cloud 開發與測試。

## 1. 上傳前確認

請先確認：

- Repository 名稱是 family-day-game
- Visibility 是 Private
- 你可以看到 Add file 按鈕
- Repository 不要放入 API Key、Git Token、密碼或 .env

如果 Repository 顯示 404，請先確認登入帳號、Repository 名稱與存取權限。

## 2. 建議的 Repository 結構

    family-day-game/
    ├─ dist/
    │  └─ index.html
    ├─ docs/
    │  ├─ prototype-續接提示詞.md
    │  └─ 正式版平台建議.md
    ├─ .openai/
    │  └─ hosting.json
    ├─ README.md
    └─ .gitignore

對應本機來源：

- dist/index.html
  C:\Users\e292879.EVERGREENEITC\Documents\Codex\2026-10-01\new-chat\dist\index.html
- docs/prototype-續接提示詞.md
  C:\Users\e292879.EVERGREENEITC\Documents\Codex\2026-10-01\new-chat\prototype-續接提示詞.md
- docs/正式版平台建議.md
  C:\Users\e292879.EVERGREENEITC\Documents\Codex\2026-10-01\new-chat\正式版平台建議.md
- .openai/hosting.json
  C:\Users\e292879.EVERGREENEITC\Documents\Codex\2026-10-01\new-chat\.openai\hosting.json

不要上傳：

- site-source/：之前發布用的重複副本
- .git/
- *.tar.gz
- .env
- API Key、Git Token、密碼

## 3. 上傳 dist/index.html

1. 進入 Repository 首頁。
2. 點擊 Add file。
3. 選擇 Create new file。
4. 在檔名欄輸入 dist/index.html。
5. 在本機開啟對應的 index.html。
6. 全選內容並複製。
7. 貼到 GitHub 編輯器。
8. Commit message 輸入 Add family day game prototype。
9. 如果可以選擇，建立新分支 bootstrap/prototype。
10. 點擊 Propose changes。

如果 Repository 是全新且沒有分支，畫面可能會顯示 Commit changes，直接提交即可。

## 4. 建立 docs 文件

### 4.1 建立續接提示詞

1. 點擊 Add file → Create new file。
2. 檔名輸入 docs/prototype-續接提示詞.md。
3. 開啟本機檔案 prototype-續接提示詞.md。
4. 複製全部內容並貼到 GitHub。
5. Commit message 輸入 Add prototype continuation prompt。

### 4.2 建立平台建議

1. 點擊 Add file → Create new file。
2. 檔名輸入 docs/正式版平台建議.md。
3. 開啟本機檔案 正式版平台建議.md。
4. 複製全部內容並貼到 GitHub。
5. Commit message 輸入 Add production platform recommendation。

## 5. 建立 .openai/hosting.json

如果未來還要使用目前的 Sites 設定，可以保留這個檔案。

1. 點擊 Add file → Create new file。
2. 檔名輸入 .openai/hosting.json。
3. 貼上以下內容：

    {
      "project_id": "appgprj_6abdabb4db9c8191bd916ac69b8e03e2",
      "static": {
        "directory": "dist"
      }
    }

4. Commit message 輸入 Add hosting configuration。

這個檔案目前沒有 API Key 或 Git Token。Codex Cloud 一般開發不依賴此檔案，但日後若要使用 Sites，可保留。

## 6. 建立 .gitignore

建立新檔案 .gitignore，貼上：

    node_modules/
    .env
    .env.*
    !.env.example
    *.tar.gz
    *.zip
    .sites-runtime/
    site-source/
    .DS_Store
    Thumbs.db

Commit message 輸入 Add repository ignore rules。

## 7. 建立 README.md

建立新檔案 README.md，貼上：

    # 家庭日｜全員出動

    公司家庭日手機網頁小遊戲。

    ## 目前狀態

    目前版本是前端 prototype，包含：

    - 暱稱加入遊戲
    - 等待開始畫面
    - 三題限時答題
    - 答對加分
    - 分數顯示
    - 排行榜
    - 重新開始

    ## 本機預覽

    直接開啟 dist/index.html。

    ## 預計正式架構

    正式版預計支援約 250 人同時參加，規劃採用：

    - Cloudflare Workers
    - Durable Objects
    - D1
    - 需要照片任務時再加入 R2

    ## 後續工作

    1. 將前端 prototype 改為真正多人同步
    2. 加入玩家、隊伍與分數資料
    3. 加入主持人控制台
    4. 加入斷線重連
    5. 加入自動化瀏覽器測試
    6. 進行 300～350 人模擬壓力測試
    7. 再部署到正式平台進行進階測試

Commit message 輸入 Add project README。

## 8. 上傳後確認

Repository 首頁應看到：

    dist/
    docs/
    .openai/
    .gitignore
    README.md

逐一確認：

- dist/index.html 包含完整 HTML、CSS 與 JavaScript
- docs/ 內有兩份 Markdown
- .openai/hosting.json 內容正確
- 沒有 Token、密碼或 .env
- site-source/ 沒有被上傳

## 9. 讓 Codex Cloud 看得到 Repository

如果 Codex Cloud 的 Repository 清單看不到 family-day-game：

1. 到 GitHub Settings。
2. 開啟 Applications 或 Installed GitHub Apps。
3. 找到 ChatGPT／Codex 使用的 GitHub 整合。
4. 進入 Configure。
5. 將 Repository access 設為只允許指定 Repository。
6. 勾選 kensairay/family-day-game。
7. 儲存後重新整理 Codex Cloud。

如果仍然看不到，通常是 GitHub App 尚未被授權該私有 Repository。
