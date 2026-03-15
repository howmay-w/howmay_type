# Discord Bot 24/7 雲端部署（Fly.io / Railway）

Bot 需要持續執行才能隨時回應 Discord。把 Bot 部署到雲端後，不需開著電腦也能用 `/新作品` 或發文建立專案、自動 push 到 GitHub，Cloudflare Pages 會依你的設定在 push 後自動更新網站。

---

## 方式一：Fly.io

### 前置

- 安裝 [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/)
- 註冊並登入：`fly auth signup` 或 `fly auth login`

### 部署步驟

1. **建立 app**（若尚未建立）。在專案根目錄執行：

   ```bash
   fly apps create howmay-type-bot
   ```

   若名稱已被佔用可改為自訂，例如 `my-discord-bot`，並把下方與 `fly.toml` 裡的 app 名稱一併改掉。

2. **設定環境變數（secrets）**，把本機 `.env` 的內容搬上去：

   ```bash
   fly secrets set DISCORD_BOT_TOKEN="你的 Bot Token"
   fly secrets set DISCORD_CHANNEL_ID="頻道 ID"
   fly secrets set DISCORD_GUILD_ID="伺服器 ID"
   fly secrets set GITHUB_TOKEN="你的 GitHub token"
   fly secrets set GITHUB_PUSH_DIRECT="true"
   ```

   （若用開 PR 模式就不要設 `GITHUB_PUSH_DIRECT`，或設為 `false`。）

3. **部署**（請務必在**專案根目錄**執行，使用根目錄的 `fly.toml`）：

   ```bash
   cd /path/to/howmay_type
   fly deploy
   ```

   若遠端建置逾時（`deadline_exceeded` 或 `EOF`），可改用本地建置再推送：

   ```bash
   fly deploy --local-only
   ```

4. **確認**：`fly logs -a howmay-type-bot` 看 log，應出現「已登入為 xxx」「監聽頻道 ID: xxx」。

### 之後更新 Bot 程式

改完程式、push 到 GitHub 後，在**專案根目錄**再執行一次：

```bash
fly deploy
```

### 注意

- Fly 免費額度有限（約 3 台 256MB 小型 VM），超出會計費；可到 [Fly 定價](https://fly.io/docs/about/pricing/) 查看。
- 若 app 名稱 `howmay-type-bot` 已被佔用，在專案根目錄的 `fly.toml` 裡改 `app = "你的名稱"`，並先 `fly apps create 你的名稱`。

---

## 方式二：Railway

不需 Docker，連上 GitHub 即可跑。**必須用「整個 repo」部署**，Bot 才會能寫入 `frontend/`、跑 `optimize-images` 與 git push。

1. 到 [Railway](https://railway.app/) 註冊，用 GitHub 登入。
2. **New Project** → **Deploy from GitHub repo** → 選 `howmay_type`。
3. 選好 repo 後，**不要**改 Root Directory（維持整個 repo）：
   - **Build Command**：`pnpm install` 或 `npm install`（若失敗可試 `cd frontend && npm install && cd ../discord-bot && npm install`）。
   - **Start Command**：`cd discord-bot && (pnpm install 2>/dev/null || npm install) && node index.mjs`。
4. **Variables** 裡加入與 `.env` 相同的變數：`DISCORD_BOT_TOKEN`、`DISCORD_CHANNEL_ID`、`DISCORD_GUILD_ID`、`GITHUB_TOKEN`、`GITHUB_PUSH_DIRECT`（選填）。
5. 部署後 Railway 會注入 `PORT`；Bot 已會監聽 `PORT` 做健康檢查。

**注意**：Railway 免費額度有限，且 build 時會拉整個 repo（含 frontend），若 build 失敗可改為用 Fly.io。

---

## 建議

- **要 24/7 且自動 push / 開 PR**：用 **Fly.io**，依上面步驟部署即可。
- 網站已用 **Cloudflare Pages**：連到同一個 GitHub repo，push 到 main 後 Cloudflare 會自動 build 並更新網站，不需額外設定。
