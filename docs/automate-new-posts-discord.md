# 自動上架新文章：Discord 表單 + 影片／圖片

這份文件說明如何把「上架新作品」做成半自動／全自動流程，並用 **Discord 當表單入口**，支援**丟影片、丟圖**後由系統讀取並產生新文章。

---

## 目前手動流程（對照）

1. 在 `frontend/src/content/projects/<slug>/` 新增資料夾
2. 撰寫 `index.md`（frontmatter + Markdown 內文）
3. 放入圖片、影片檔
4. 執行 `pnpm optimize-images`（在 frontend 目錄）
5. 部署（例如 push 到 main 觸發 Netlify 等）

自動化的目標：**從 Discord 填表單、上傳媒體 → 自動產生 1～4，再由 CI 部署**。

---

## 整體架構選項

### 方案 A：Discord Bot（表單 + 附件）→ 產生內容 → GitHub PR

- 在 Discord 建立一個 Bot，用 **Slash Command**（例如 `/新作品`）打開 **Modal** 填寫：
  - 標題、描述、內文、標籤、發佈日（選填）
- 使用者再在**同一頻道**發一則訊息，**附上圖片／影片**（或 Bot 引導「請上傳圖片與影片」）。
- Bot 收到後：
  1. 下載所有附件到暫存
  2. 呼叫「建立新作品」的腳本或 API（見下方腳本），產生 `projects/<slug>/` 與 `index.md`，並把媒體複製進去
  3. 用 **GitHub API** 開一個 **branch + PR**（內容包含新資料夾與檔案）
- 你或團隊在 GitHub 審核 PR，合併後由現有 CI 部署；若 CI 有跑 `optimize-images`，則圖也會被優化。

**優點**：全部在 Discord 完成，真的可以「丟影片丟圖」給 Bot 讀取。  
**需要**：Discord Application（Bot Token）、有寫入 repo 權限的 GitHub Token（例如 PAT）。

---

### 方案 B：表單（Google Form / Typeform / 自建） + Webhook → 同一個腳本

- 表單欄位：標題、描述、內文、標籤、發佈日、**圖片／影片連結**（或上傳到雲端後貼 URL）。
- 表單送出時觸發 **Webhook**（或排程檢查表單結果），把資料送給一個小後端或 **GitHub Actions**。
- 後端／Action 呼叫同一個「建立新作品」腳本：用 **URL 下載**媒體，再產生 `index.md` 與資料夾，然後開 PR 或直接 push。

**優點**：不一定要會寫 Discord Bot，表單可自訂。  
**缺點**：若用「連結」而非 Discord 直接上傳，需要先把影片／圖傳到某處再貼連結。

---

### 方案 C：Discord 頻道 + Bot 監聽「帶附件的訊息」（已實作）

- 不用 Modal，直接在一個專用頻道發一則訊息：**第一行當標題**，後面用 Markdown 寫內文，並**附上圖片／影片**。
- Bot 監聽該頻道，偵測到符合格式的訊息就：用附件 URL 組 payload → 呼叫 `frontend/scripts/create-project-from-payload.mjs` 建立新作品。

**實作**：見 `discord-bot/` 目錄，依 README 設定 `DISCORD_BOT_TOKEN`、`DISCORD_CHANNEL_ID` 後執行 `pnpm start`。

**優點**：實作比 Slash Command + Modal 簡單，一樣能「丟影片丟圖」。  
**缺點**：格式要固定，且要小心誤觸（例如限制在特定頻道或只有特定身分）。

---

## 建議：先做「產生內容」腳本，再串 Discord

不論用哪一個方案，核心都是同一個步驟：**有一份「標題、描述、內文、標籤、媒體」的資料，要寫入 `projects/<slug>/`**。

專案裡已提供一個腳本範例：

- **腳本**：`frontend/scripts/create-project-from-payload.mjs`
- **範例 payload**：`frontend/scripts/payload.example.json`
- **輸入**：JSON payload（可來自 Discord Bot、Webhook、或手動執行）
- **輸出**：在 `src/content/projects/<slug>/` 建立資料夾、`index.md`，以及從 URL 下載的媒體檔（或使用本地路徑）
- **注意**：產出的 `index.md` 裡圖片路徑為 `.webp`（對應跑完 `optimize-images` 後的檔名），所以**建立後請在 frontend 目錄執行一次 `pnpm optimize-images`**，圖才會正確顯示。

之後你可以：

1. **手動**：編輯 `payload.json`、放好媒體 URL 或路徑，執行腳本做測試。
2. **Discord Bot**：Bot 下載附件後，把路徑或暫存 URL 傳給同一支腳本（或包一層小 API 呼叫它）。
3. **Webhook**：表單送出的資料轉成同一份 JSON 格式，由 GitHub Action 或小後端執行該腳本，再開 PR。

---

## Discord 實作要點（方案 A / C）

1. **建立 Discord Application 與 Bot**
   - [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot → 複製 Token。
   - 啟用 **Message Content Intent**（若 Bot 要讀頻道訊息內容／附件）。
   - 用 OAuth2 把 Bot 邀請到你的 server，權限勾選：`applications.commands`、`Send Messages`、`Attach Files`、讀該頻道訊息等。

2. **Slash Command + Modal（方案 A）**
   - 註冊 Slash Command（例如 `/新作品`），在 `interaction` 時回傳 `Modal`，欄位：標題、描述、內文、標籤、發佈日。
   - 使用者提交 Modal 後，Bot 回覆「請在同一則討論串上傳圖片與影片」；用 `messageCreate` 監聽該頻道，若該訊息是回覆 Bot 且帶附件，就與剛才暫存的表單資料配對，下載附件並呼叫建立新作品腳本。

3. **讀取附件**
   - Discord 附件有 `url`，Bot 用 HTTP GET 下載即可（若需要認證可帶 Bot Token）。下載後存到本機暫存，再傳給 `create-project-from-payload.mjs` 的「本地路徑」介面，或先上傳到某個雲端再傳 URL 給腳本。

4. **開 GitHub PR**
   - 腳本只負責在本地產出 `projects/<slug>/`。要自動開 PR，可以：
     - 在 Bot 所在環境（例如 VPS、Cloud Function）執行 `git checkout -b feat/new-post-<slug>`、複製腳本產出的檔案、`git add`、`git commit`、`git push`，再用 GitHub API 開 PR；或
     - 用 [repository_dispatch](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#repository_dispatch) 觸發 GitHub Action，把 payload 傳給 Action，在 Action 裡跑腳本、開 PR（需把 GitHub Token 設成 secret）。

---

## 流程總結

```
[Discord 表單 + 丟影片/圖]
        ↓
  Discord Bot 下載附件
        ↓
  組成 payload（標題、描述、內文、標籤、媒體路徑或 URL）
        ↓
  create-project-from-payload.mjs
  → 建立 projects/<slug>/、index.md、下載/複製媒體
        ↓
  （可選）optimize-images
        ↓
  GitHub：開 PR 或 push → CI 部署
```

這樣就能做到：**在 Discord 填表單、丟影片丟圖，由系統讀取並自動產生新文章**；審核後合併即可上架。
