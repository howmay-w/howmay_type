# 方案 C：Discord 頻道發文 → 自動建立新作品

兩種方式二擇一或並用：

1. **表單**：在頻道輸入 `/新作品`，在彈出表單填**標題**、**標籤**、**內文**（支援 Markdown，如 `---`）；送出後在**本頻道**再發一則**帶圖片或影片**的訊息即建立專案。  
   - **description** 會自動從內文第一段擷取。  
   - 若標籤含有 `#whatzurtype`（或 `whatzurtype`），會自動在文末加上「本作品投稿 YYYY 年 M 月 @justfont #whatzurtype 設計串聯」。

2. **發文**：直接發一則訊息，**第一行當標題**、下面寫內文並**附上圖片或影片**，Bot 同樣會建立專案（同上，內文第一段當 description，標籤可從內文辨識 #whatzurtype 並加投稿資訊）。

## 前置需求

1. **Bot Token**（不是應用程式 ID 或公開金鑰）  
   在 [Discord 開發者後台](https://discord.com/developers/applications) → 你的應用程式 → **Bot** → **Reset Token** / **Copy**，取得 `DISCORD_BOT_TOKEN`。

2. **Bot 權限與邀請連結**  
   - 在 Bot 頁面勾選 **Message Content Intent**（「讀取訊息內容」）。  
   - 邀請 Bot 時，**Scopes 必須勾選「bot」與「applications.commands」**，否則 `/新作品` 會註冊失敗（Missing Access）。  
   - 路徑：開發者後台 → **OAuth2** → **URL 生成器** → Scopes 勾選 **bot**、**applications.commands** → Bot 權限勾選「讀取訊息／頻道」「查看頻道」「讀取訊息歷史」→ 複製產生的網址並在瀏覽器開啟，選擇你的伺服器加入。  
   - 若 Bot 已在伺服器內但之前沒勾 `applications.commands`，用上述連結再執行一次即可更新權限（不需踢出 Bot）。

3. **頻道 ID**  
   Discord 設定 → 進階 → 開啟 **開發者模式**，對要監聽的頻道右鍵 → **複製頻道 ID**，填到 `DISCORD_CHANNEL_ID`。

4. **應用程式 ID**（選填）  
   現在會自動用 Bot 的應用程式 ID 註冊指令，不必再填 `DISCORD_APPLICATION_ID`。若曾填過可保留或刪除皆可。

5. **伺服器 ID**（建議填，指令會馬上出現）  
   開發者模式開啟後，在左側**伺服器列表**（最左邊直排的圖示）對**伺服器圖示**右鍵 → **複製伺服器 ID**，填到 `DISCORD_GUILD_ID`。  
   **注意**：這是「伺服器」ID，不是「頻道」ID。若你把頻道 ID 填到 `DISCORD_GUILD_ID`（會和 `DISCORD_CHANNEL_ID` 一樣），會出現 Missing Access。  
   **重要**：`DISCORD_GUILD_ID` 必須是「你點 Bot 邀請連結時選的那個伺服器」的 ID。不填則指令會註冊為「全球」，可能需等約 1 小時才會在 Discord 顯示。

6. **GitHub Token**（選填，用於自動 push）  
   [GitHub → Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens) 建立 token，權限勾選 **repo**，填到 `GITHUB_TOKEN`。設定後會自動 commit、push。  
   - **直接 push**：在 `.env` 加上 `GITHUB_PUSH_DIRECT=true`，會直接 push 到目前分支（如 main），不開 PR，部署會自動進行。  
   - **開 PR**：不設或設為 false 時，會 push 新分支並用 API 開 PR；若 API 失敗，Discord 會給「手動開 PR」連結。

## 安裝與執行

```bash
# 在專案根目錄
cd discord-bot
pnpm install

# 複製環境變數並編輯
cp .env.example .env
# 在 .env 填上 DISCORD_BOT_TOKEN 和 DISCORD_CHANNEL_ID

# 啟動 Bot（前台執行）
pnpm start
```

## 使用方式

### 方式一：/新作品 表單（建議）

1. 在頻道輸入 `/新作品`，送出後會跳出表單。
2. 填寫**標題**、**標籤**（例如 `whatzurtype, 字體`）、**內文**（支援 Markdown，含 `---` 分隔線）。
3. 送出表單後，在**同頻道**再發一則**帶圖片或影片**的訊息（可只發附件，不需再打標題）。
4. Bot 會用表單的標題／標籤／內文 + 該則訊息的附件建立專案。  
   - **description** 自動取內文第一段。  
   - 標籤有 `whatzurtype` 時會自動在文末加上投稿資訊（年月份以當日為準）。

### 方式二：直接發文

在該頻道發一則訊息，第一行當標題、下面寫內文，並附上圖片或影片；Bot 會依內文與附件建立專案（同上，第一段當 description，標籤含 #whatzurtype 會加投稿資訊）。

**自動化與圖片壓縮**：

- 若在 `.env` 設定 **GITHUB_TOKEN**（權限勾選 `repo`），建立專案後會自動 commit、push（依 `GITHUB_PUSH_DIRECT` 決定直推 main 或開 PR）。
- **Fly 等小記憶體環境**：建議設 **`SKIP_OPTIMIZE_IMAGES=true`**（與根目錄 `fly.toml` 一致），Bot **不**在容器內跑 `optimize-images`，改由 **[GitHub Actions](../.github/workflows/optimize-images.yml)** 在 push 到 `main` 後自動壓縮 `frontend/src/content/projects/` 內圖片並再 commit；可省 Fly VM 記憶體與費用。
- **本機開發**：不設 `SKIP_OPTIMIZE_IMAGES`（或設為 false）時，行為與以往相同，建立專案後會在本地執行 `pnpm optimize-images`。

**24/7 雲端運行**：若希望 Bot 不需開著電腦也能隨時運作，可部署到 Fly.io 或 Railway，見 [docs/discord-bot-deploy.md](../docs/discord-bot-deploy.md)。

## 注意

- 只有**有附件的訊息**且**在指定頻道**才會觸發，避免在該頻道亂發文造成誤建。
- 若希望只有特定身分能觸發，可在程式裡加 `message.member.roles.cache.has('某 Role ID')` 判斷。
