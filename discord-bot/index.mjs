/**
 * 方案 C + 表單：/新作品 開 Modal 填標題、標籤、內文；
 * 送出後請在同一頻道發一則帶圖/影片的訊息即建立專案。
 * description 自動從內文第一段擷取；若標籤含 #whatzurtype 則自動加投稿資訊。
 */

import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  ActionRowBuilder,
  TextInputStyle,
  Events,
} from "discord.js";
import { spawn, spawnSync, execSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const FRONTEND_DIR = path.join(REPO_ROOT, "frontend");
const SCRIPT_PATH = path.join(FRONTEND_DIR, "scripts", "create-project-from-payload.mjs");

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
/** 設為 true 時直接 push 到目前分支（如 main），不開新分支與 PR */
const GITHUB_PUSH_DIRECT = process.env.GITHUB_PUSH_DIRECT === "true" || process.env.GITHUB_PUSH_DIRECT === "1";
/** Fly 等小記憶體環境：不在容器內跑 sharp，改由 GitHub Actions 壓縮（見 .github/workflows/optimize-images.yml） */
const SKIP_OPTIMIZE_IMAGES = process.env.SKIP_OPTIMIZE_IMAGES === "true" || process.env.SKIP_OPTIMIZE_IMAGES === "1";

if (!DISCORD_BOT_TOKEN) {
  console.error("[啟動失敗] 請設定環境變數 DISCORD_BOT_TOKEN（在 Discord 開發者後台 Bot 頁面取得）");
  process.exit(1);
}
if (!DISCORD_CHANNEL_ID) {
  console.error("[啟動失敗] 請設定環境變數 DISCORD_CHANNEL_ID（要監聽的頻道 ID）");
  process.exit(1);
}
console.log("[Discord Bot] 環境變數檢查通過，正在連線 Discord…");

// 雲端平台健康檢查（Fly.io、Railway 等會設 PORT）
const PORT = process.env.PORT;
if (PORT) {
  http.createServer((_req, res) => { res.writeHead(200); res.end("ok"); }).listen(Number(PORT));
}

/** 暫存：channelId_userId -> { title, tags, body, description, pubDate } */
const pendingByChannelUser = new Map();

const WHATZURTYPE_FOOTER =
  "\n\n---\n\n本作品投稿 {year} 年 {month} 月 [@justfont](https://www.instagram.com/justfont/) [#whatzurtype](https://www.instagram.com/explore/search/keyword/?q=%23whatzurtype) 設計串聯。";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

function isImage(att) {
  const ct = (att.contentType || att.content_type || "").toLowerCase();
  const name = (att.name || att.filename || "").toLowerCase();
  return ct.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp)$/.test(name);
}

function isVideo(att) {
  const ct = (att.contentType || att.content_type || "").toLowerCase();
  const name = (att.name || att.filename || "").toLowerCase();
  return ct.startsWith("video/") || /\.(mp4|webm|mov|avi)$/.test(name);
}

function parseTags(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[\s,#]+/)
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function hasWhatzurtype(tags) {
  return tags.some((t) => /whatzurtype/i.test(t));
}

// Discord 的輸入框會把 -- 自動轉成 —，導致 --- 變成 —-
// 這裡還原回標準 Markdown 分隔線
function fixDiscordDashes(text) {
  if (!text) return text;
  return text.replace(/—-/g, "---").replace(/——/g, "----");
}

function descriptionFromBody(body) {
  if (!body || !String(body).trim()) return undefined;
  const first = String(body).split(/\n\n/)[0];
  return first.replace(/\s+/g, " ").trim().slice(0, 160) || undefined;
}

function slugify(title) {
  return title
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "untitled";
}

function runOptimizeImages() {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["--filter", "frontend", "run", "optimize-images"], {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("error", (err) => reject(new Error(`optimize-images 執行錯誤: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const detail = [stderr, stdout].filter(Boolean).join("\n").trim().slice(0, 800);
      reject(new Error(`圖片壓縮失敗 (結束碼 ${code})${detail ? `\n\`\`\`\n${detail}\`\`\`` : ""}`));
    });
  });
}

const GIT_PACK_MEM = "-c pack.windowMemory=128m -c pack.deltaCacheSize=128m";

/** 與 origin 同步。需在「工作區乾淨」時呼叫（例如 commit 後再 push 前），或建立專案檔之前。 */
function pullRebaseOrigin(branch) {
  execSync(`git ${GIT_PACK_MEM} pull --rebase origin ${branch}`, { cwd: REPO_ROOT });
}

/**
 * 在寫入專案檔之前與 origin 對齊（Fly 容器專用）。
 * 使用 fetch + reset --hard，避免 stash 與 node_modules 衝突；會丟棄本機未 push 的 commit 與已追蹤變更。
 */
function syncOriginBeforeLocalChanges() {
  const remote = execSync("git config --get remote.origin.url", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const match = remote.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  const repo = match ? match[1].replace(/\.git$/, "") : null;
  if (!repo || !GITHUB_TOKEN) return { ok: true };
  let branch;
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return { ok: false, error: "無法取得目前分支" };
  }
  const originUrl = remote;
  const authUrl = `https://x-access-token:${GITHUB_TOKEN}@github.com/${repo}.git`;
  try {
    execSync(`git remote set-url origin ${authUrl}`, { cwd: REPO_ROOT });
    execSync(`git ${GIT_PACK_MEM} fetch origin`, { cwd: REPO_ROOT });
    execSync(`git reset --hard origin/${branch}`, { cwd: REPO_ROOT });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e?.message || String(e)).trim().slice(0, 400) };
  } finally {
    execSync(`git remote set-url origin ${originUrl}`, { cwd: REPO_ROOT });
  }
}

/** 直接 push 到目前分支（不開新分支、不開 PR）。回傳 { ok, error? }。commitMsg 可選。 */
function pushDirectToCurrentBranch(title, slug, commitMsg) {
  const projectPath = `frontend/src/content/projects/${slug}`;
  const remote = execSync("git config --get remote.origin.url", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const match = remote.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  const repo = match ? match[1].replace(/\.git$/, "") : null;
  if (!repo || !GITHUB_TOKEN) return { ok: false, error: "缺少 repo 或 GITHUB_TOKEN" };
  let currentBranch;
  try {
    currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return { ok: false, error: "無法取得目前分支" };
  }
  const message = commitMsg || `feat: 新增作品「${title}」`;
  const originUrl = remote;
  const authUrl = `https://x-access-token:${GITHUB_TOKEN}@github.com/${repo}.git`;
  try {
    execSync(`git remote set-url origin ${authUrl}`, { cwd: REPO_ROOT });
    execSync(`git add "${projectPath}"`, { cwd: REPO_ROOT });
    // 容器環境常未設定 user.name/email，改用 -c 避免 commit 直接失敗
    const commitResult = spawnSync(
      "git",
      [
        "-c",
        "user.name=howmay-type-bot",
        "-c",
        "user.email=howmay-type-bot@users.noreply.github.com",
        "commit",
        "-m",
        message,
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }
    );
    if (commitResult.status !== 0) {
      const detail = (commitResult.stderr || commitResult.stdout || "git commit 失敗").trim().slice(0, 400);
      return { ok: false, error: detail };
    }
    pullRebaseOrigin(currentBranch);
    execSync(`git ${GIT_PACK_MEM} push origin ${currentBranch}`, { cwd: REPO_ROOT });
    return { ok: true };
  } catch (e) {
    const msg = (e?.message || String(e)).trim().slice(0, 400);
    return { ok: false, error: msg };
  } finally {
    execSync(`git remote set-url origin ${originUrl}`, { cwd: REPO_ROOT });
  }
}

/** 開新分支、push、用 API 開 PR。回傳 { prUrl, manualPrUrl }。commitMsg 可選。 */
async function createPrAndReply(title, slug, commitMsg) {
  const projectPath = `frontend/src/content/projects/${slug}`;
  const remote = execSync("git config --get remote.origin.url", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const match = remote.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  const repo = match ? match[1].replace(/\.git$/, "") : null;
  if (!repo || !GITHUB_TOKEN) return { prUrl: null, manualPrUrl: null };
  let currentBranch;
  try {
    currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    throw new Error("無法取得目前分支");
  }
  const branchName = `feat/discord-${slug}-${Date.now().toString(36)}`;
  const manualPrUrl = `https://github.com/${repo}/pull/new/${encodeURIComponent(branchName)}`;
  const message = commitMsg || `feat: 新增作品「${title}」`;
  const originUrl = remote;
  const authUrl = `https://x-access-token:${GITHUB_TOKEN}@github.com/${repo}.git`;
  try {
    execSync(`git remote set-url origin ${authUrl}`, { cwd: REPO_ROOT });
    execSync(`git checkout -b ${branchName}`, { cwd: REPO_ROOT });
    execSync(`git add "${projectPath}"`, { cwd: REPO_ROOT });
    const commitResult = spawnSync(
      "git",
      [
        "-c",
        "user.name=howmay-type-bot",
        "-c",
        "user.email=howmay-type-bot@users.noreply.github.com",
        "commit",
        "-m",
        message,
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }
    );
    if (commitResult.status !== 0) throw new Error(commitResult.stderr || commitResult.stdout || "git commit 失敗");
    execSync(`git ${GIT_PACK_MEM} fetch origin`, { cwd: REPO_ROOT });
    execSync(`git ${GIT_PACK_MEM} rebase origin/${currentBranch}`, { cwd: REPO_ROOT });
    execSync(`git ${GIT_PACK_MEM} push -u origin ${branchName}`, { cwd: REPO_ROOT });
  } finally {
    execSync(`git checkout ${currentBranch}`, { cwd: REPO_ROOT });
    execSync(`git remote set-url origin ${originUrl}`, { cwd: REPO_ROOT });
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: `新增作品：${title}`,
      head: branchName,
      base: currentBranch,
      body: `由 Discord Bot 自動建立。`,
    }),
  });
  if (!res.ok) return { prUrl: null, manualPrUrl };
  const pr = await res.json();
  return { prUrl: pr.html_url || null, manualPrUrl };
}

function runCreateProject(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH], {
      cwd: FRONTEND_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`腳本結束碼 ${code}\n${stderr || stdout}`));
      const statusMatch = stdout.match(/STATUS:\s*(created|overwritten|updated)/);
      const status = statusMatch ? statusMatch[1] : "created";
      resolve({ stdout, stderr, status });
    });
    child.stdin.write(JSON.stringify(payload), "utf8", () => {
      child.stdin.end();
    });
  });
}

client.on(Events.ClientReady, async () => {
  console.log(`已登入為 ${client.user.tag}`);
  console.log(`監聽頻道 ID: ${DISCORD_CHANNEL_ID}`);

  const appId = client.application?.id;
  if (!appId) {
    console.warn("無法取得應用程式 ID，跳過 Slash Command 註冊");
    return;
  }
  console.log(`應用程式 ID（與 Token 對應）：${appId}`);
  if (DISCORD_GUILD_ID) {
    console.log(`註冊目標伺服器 ID：${DISCORD_GUILD_ID}`);
    if (DISCORD_GUILD_ID === DISCORD_CHANNEL_ID) {
      console.warn(
        "⚠️  伺服器 ID 與頻道 ID 相同！DISCORD_GUILD_ID 必須填「伺服器」ID，不是頻道 ID。\n" +
          "   請在左側伺服器列表對「伺服器圖示」右鍵 → 複製伺服器 ID，不要對頻道右鍵。"
      );
    }
  }

  const rest = new REST().setToken(DISCORD_BOT_TOKEN);
  const commands = [
    new SlashCommandBuilder()
      .setName("新作品")
      .setDescription("填寫標題、標籤、內文後，再發一則帶圖/影片的訊息即可建立專案")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("修改作品")
      .setDescription("僅更新現有專案的內文／描述／標籤，不重新上傳圖片")
      .toJSON(),
  ];
  try {
    if (DISCORD_GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(appId, DISCORD_GUILD_ID), { body: commands });
      console.log("已註冊 Slash Command：/新作品、/修改作品（僅此伺服器，會立即出現）");
    } else {
      await rest.put(Routes.applicationCommands(appId), { body: commands });
      console.log("已註冊 Slash Command：/新作品（全球指令，最多約 1 小時後才會出現）");
    }
  } catch (e) {
    console.warn("註冊 Slash Command 失敗（不影響監聽發文）：", e.message);
    if (e.message && e.message.includes("Missing Access")) {
      console.warn(
        "→ 請用「應用程式指令」權限重新邀請 Bot：\n" +
          "  開發者後台 → 你的應用程式 → OAuth2 → URL 生成器\n" +
          "  Scopes 勾選「bot」與「applications.commands」→ 選伺服器 → 產生連結並在瀏覽器開啟\n" +
          "  或直接開啟：https://discord.com/api/oauth2/authorize?client_id=" +
          appId +
          "&permissions=3072&scope=bot%20applications.commands"
      );
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "新作品") {
    const modal = new ModalBuilder()
      .setCustomId("new_project_modal")
      .setTitle("新作品")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("title")
            .setLabel("標題")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("作品標題")
            .setRequired(true)
            .setMaxLength(256)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("tags")
            .setLabel("標籤")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("可用空格或逗號分隔，例如：whatzurtype 字體（有 #whatzurtype 會自動加投稿資訊）")
            .setRequired(false)
            .setMaxLength(256)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("body")
            .setLabel("內文（支援 Markdown，如 --- 分隔線）")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("第一段會自動當作 description")
            .setRequired(false)
            .setMaxLength(4000)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === "new_project_modal") {
    const title = interaction.fields.getTextInputValue("title").trim() || "未命名作品";
    const tagsRaw = interaction.fields.getTextInputValue("tags")?.trim() || "";
    const body = fixDiscordDashes(interaction.fields.getTextInputValue("body")?.trim() || "");
    const tags = parseTags(tagsRaw);
    const description = descriptionFromBody(body);
    const pubDate = new Date().toISOString().slice(0, 10);
    const key = `${interaction.channelId}_${interaction.user.id}`;
    pendingByChannelUser.set(key, { title, tags, body, description, pubDate });
    await interaction.reply({
      content: "已收到！請在**本頻道**發送一則**帶有圖片或影片**的訊息，我將為你建立專案。",
      ephemeral: true,
    });
  }
});

client.on("messageCreate", async (message) => {
  if (message.channelId !== DISCORD_CHANNEL_ID) return;
  if (message.author.bot) return;

  const key = `${message.channelId}_${message.author.id}`;
  const pending = pendingByChannelUser.get(key);
  const attachments = [...message.attachments.values()];
  const images = attachments.filter(isImage);
  const videos = attachments.filter(isVideo);

  if (pending && images.length + videos.length > 0) {
    pendingByChannelUser.delete(key);
    let body = pending.body;
    if (hasWhatzurtype(pending.tags)) {
      const [y, m] = pending.pubDate.split("-");
      body += WHATZURTYPE_FOOTER.replace("{year}", y).replace("{month}", String(Number(m)));
    }
    const payload = {
      title: pending.title,
      description: pending.description,
      body,
      tags: pending.tags.length ? pending.tags : undefined,
      pubDate: pending.pubDate,
      images: images.map((a) => ({ url: a.url, alt: a.name || undefined })),
      videos: videos.map((a) => ({ url: a.url })),
      hoverVideoIndex: 0,
      overwrite: true,
    };
    const reply = await message.reply("正在建立專案…").catch(() => null);
    const update = (text) => reply?.edit(text).catch(() => {});
    try {
      if (GITHUB_TOKEN) {
        const sync = syncOriginBeforeLocalChanges();
        if (!sync.ok) {
          await update(`❌ 無法與 GitHub 同步：${sync.error}`);
          return;
        }
      }
      const { status } = await runCreateProject(payload);
      const statusLabel = status === "overwritten" ? "已覆寫專案" : "已建立專案";
      if (SKIP_OPTIMIZE_IMAGES) {
        await update(`✅ ${statusLabel}：\`${pending.title}\`\n正在處理 push…（圖片壓縮由 GitHub Actions 執行）`);
      } else {
        await update(`✅ ${statusLabel}：\`${pending.title}\`\n正在優化圖片…`);
        await runOptimizeImages();
      }
      let resultMsg = SKIP_OPTIMIZE_IMAGES
        ? `✅ ${statusLabel}：\`${pending.title}\`，已 push；GitHub Actions 將自動轉 WebP`
        : `✅ ${statusLabel}：\`${pending.title}\`，已執行 \`optimize-images\``;
      if (GITHUB_TOKEN) {
        const slug = slugify(pending.title);
        const commitMsg = status === "overwritten" ? `feat: 覆寫作品「${pending.title}」` : `feat: 新增作品「${pending.title}」`;
        if (GITHUB_PUSH_DIRECT) {
          await update(`${resultMsg}\n正在 push…`);
          const { ok, error } = pushDirectToCurrentBranch(pending.title, slug, commitMsg);
          resultMsg += ok
            ? "\n已 **push** 到目前分支，部署會自動進行。"
            : `\n（push 失敗：${(error || "未知原因").slice(0, 180)}）`;
        } else {
          await update(`${resultMsg}\n正在開 PR…`);
          try {
            const { prUrl, manualPrUrl } = await createPrAndReply(pending.title, slug, commitMsg);
            resultMsg += prUrl
              ? `\n**PR：** ${prUrl}`
              : manualPrUrl
                ? `\n（API 開 PR 失敗）**手動開 PR：** ${manualPrUrl}`
                : "\n（開 PR 失敗，請手動 push）";
          } catch (e) {
            console.error(e);
            resultMsg += "\n（開 PR 失敗，請手動 push）";
          }
        }
      } else {
        resultMsg += "。請手動 push 或開 PR 部署。";
      }
      await update(resultMsg);
    } catch (err) {
      console.error(err);
      const hint =
        /圖片壓縮|optimize-images|sharp/.test(err.message)
          ? "\n\n💡 若為圖片壓縮失敗，可在**本地**於專案根目錄執行 `pnpm optimize-images` 後再 push。"
          : "";
      await update(`❌ 建立失敗：${err.message}${hint}`);
    }
    return;
  }

  if (pending) return;
  const content = (message.content || "").trim();
  if (attachments.length === 0) return;
  if (images.length === 0 && videos.length === 0) return;

  const firstLine = content.split("\n")[0]?.trim() || "";
  const rest = content.slice(firstLine.length).trim();
  const title = firstLine || "未命名作品";
  const tags = (content.match(/#(\S+)/g) || []).map((s) => s.replace(/^#/, "").trim()).filter(Boolean);
  let body = rest;
  if (hasWhatzurtype(tags)) {
    const pubDate = new Date().toISOString().slice(0, 10);
    const [y, m] = pubDate.split("-");
    body += WHATZURTYPE_FOOTER.replace("{year}", y).replace("{month}", String(Number(m)));
  }
  const payload = {
    title,
    description: descriptionFromBody(rest),
    body,
    tags: tags.length ? tags : undefined,
    pubDate: new Date().toISOString().slice(0, 10),
    images: images.map((a) => ({ url: a.url, alt: a.name || undefined })),
    videos: videos.map((a) => ({ url: a.url })),
    hoverVideoIndex: 0,
    overwrite: true,
  };

  const reply = await message.reply("正在建立專案…").catch(() => null);
  const update = (text) => reply?.edit(text).catch(() => {});

  try {
    if (GITHUB_TOKEN) {
      const sync = syncOriginBeforeLocalChanges();
      if (!sync.ok) {
        await update(`❌ 無法與 GitHub 同步：${sync.error}`);
        return;
      }
    }
    const { status } = await runCreateProject(payload);
    const statusLabel = status === "overwritten" ? "已覆寫專案" : "已建立專案";
    if (SKIP_OPTIMIZE_IMAGES) {
      await update(`✅ ${statusLabel}：\`${title}\`\n正在處理 push…（圖片壓縮由 GitHub Actions 執行）`);
    } else {
      await update(`✅ ${statusLabel}：\`${title}\`\n正在優化圖片…`);
      await runOptimizeImages();
    }
    let resultMsg = SKIP_OPTIMIZE_IMAGES
      ? `✅ ${statusLabel}：\`${title}\`，已 push；GitHub Actions 將自動轉 WebP`
      : `✅ ${statusLabel}：\`${title}\`，已執行 \`optimize-images\``;
    if (GITHUB_TOKEN) {
      const slug = slugify(title);
      const commitMsg = status === "overwritten" ? `feat: 覆寫作品「${title}」` : `feat: 新增作品「${title}」`;
      if (GITHUB_PUSH_DIRECT) {
        await update(`${resultMsg}\n正在 push…`);
        const { ok, error } = pushDirectToCurrentBranch(title, slug, commitMsg);
        resultMsg += ok
          ? "\n已 **push** 到目前分支，部署會自動進行。"
          : `\n（push 失敗：${(error || "未知原因").slice(0, 180)}）`;
      } else {
        await update(`${resultMsg}\n正在開 PR…`);
        try {
          const { prUrl, manualPrUrl } = await createPrAndReply(title, slug, commitMsg);
          resultMsg += prUrl
            ? `\n**PR：** ${prUrl}`
            : manualPrUrl
              ? `\n（API 開 PR 失敗）**手動開 PR：** ${manualPrUrl}`
              : "\n（開 PR 失敗，請手動 push）";
        } catch (e) {
          console.error(e);
          resultMsg += "\n（開 PR 失敗，請手動 push）";
        }
      }
    } else {
      resultMsg += "。請手動 push 或開 PR 部署。";
    }
    await update(resultMsg);
  } catch (err) {
    console.error(err);
    const hint =
      /圖片壓縮|optimize-images|sharp/.test(err.message)
        ? "\n\n💡 若為圖片壓縮失敗，可在**本地**於專案根目錄執行 `pnpm optimize-images` 後再 push。"
        : "";
    await update(`❌ 建立失敗：${err.message}${hint}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "修改作品") {
    const modal = new ModalBuilder()
      .setCustomId("edit_project_modal")
      .setTitle("修改作品內文")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("title")
            .setLabel("作品標題（與現有專案一致）")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("用來對應要修改的專案")
            .setRequired(true)
            .setMaxLength(256)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("body")
            .setLabel("內文（Markdown）")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("新的內文，會完整取代原內文")
            .setRequired(true)
            .setMaxLength(4000)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("description")
            .setLabel("描述（選填，留空不改）")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("一句話描述")
            .setRequired(false)
            .setMaxLength(256)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("tags")
            .setLabel("標籤（選填，留空不改，逗號分隔）")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("tag1, tag2")
            .setRequired(false)
            .setMaxLength(256)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === "edit_project_modal") {
    const title = interaction.fields.getTextInputValue("title").trim() || "";
    const body = fixDiscordDashes(interaction.fields.getTextInputValue("body").trim() || "");
    const descriptionRaw = interaction.fields.getTextInputValue("description")?.trim() || "";
    const tagsRaw = interaction.fields.getTextInputValue("tags")?.trim() || "";
    if (!title) {
      await interaction.reply({ content: "請填寫作品標題以對應專案。", ephemeral: true }).catch(() => {});
      return;
    }
    const slug = slugify(title);
    const payload = {
      onlyUpdateBody: true,
      slug,
      title,
      body,
      ...(descriptionRaw && { description: descriptionRaw }),
      ...(tagsRaw && { tags: parseTags(tagsRaw) }),
    };
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const editReply = (text) => interaction.editReply(text).catch(() => {});
    try {
      if (GITHUB_TOKEN) {
        const sync = syncOriginBeforeLocalChanges();
        if (!sync.ok) {
          await editReply(`❌ 無法與 GitHub 同步：${sync.error}`);
          return;
        }
      }
      const { status } = await runCreateProject(payload);
      if (status !== "updated") {
        await editReply(`❌ 無法更新（請確認標題與現有專案一致）：\`${title}\``);
        return;
      }
      let resultMsg = `✅ 已更新專案內文：\`${title}\``;
      if (GITHUB_TOKEN) {
        const commitMsg = `docs: 更新作品「${title}」內文`;
        if (GITHUB_PUSH_DIRECT) {
          await editReply(`${resultMsg}\n正在 push…`);
          const { ok, error } = pushDirectToCurrentBranch(title, slug, commitMsg);
          resultMsg += ok ? "\n已 **push** 到目前分支。" : `\n（push 失敗：${(error || "").slice(0, 120)}）`;
        } else {
          await editReply(`${resultMsg}\n正在開 PR…`);
          try {
            const { prUrl, manualPrUrl } = await createPrAndReply(title, slug, commitMsg);
            resultMsg += prUrl ? `\n**PR：** ${prUrl}` : manualPrUrl ? `\n**手動開 PR：** ${manualPrUrl}` : "\n（開 PR 失敗）";
          } catch (e) {
            resultMsg += "\n（開 PR 失敗）";
          }
        }
      }
      await editReply(resultMsg);
    } catch (err) {
      console.error(err);
      await editReply(`❌ 更新失敗：${err.message}`).catch(() => {});
    }
    return;
  }
});

client.login(DISCORD_BOT_TOKEN).catch((err) => {
  console.error("[啟動失敗] 登入 Discord 失敗：", err.message);
  process.exit(1);
});
