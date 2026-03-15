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

if (!DISCORD_BOT_TOKEN) {
  console.error("請設定環境變數 DISCORD_BOT_TOKEN（在 Discord 開發者後台 Bot 頁面取得）");
  process.exit(1);
}
if (!DISCORD_CHANNEL_ID) {
  console.error("請設定環境變數 DISCORD_CHANNEL_ID（要監聽的頻道 ID）");
  process.exit(1);
}

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
      stdio: "inherit",
      shell: true,
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`optimize-images 結束碼 ${code}`))));
  });
}

/** 直接 push 到目前分支（不開新分支、不開 PR）。成功回傳 true。 */
function pushDirectToCurrentBranch(title, slug) {
  const projectPath = `frontend/src/content/projects/${slug}`;
  const remote = execSync("git config --get remote.origin.url", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const match = remote.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  const repo = match ? match[1].replace(/\.git$/, "") : null;
  if (!repo || !GITHUB_TOKEN) return false;
  let currentBranch;
  try {
    currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return false;
  }
  const originUrl = remote;
  const authUrl = `https://x-access-token:${GITHUB_TOKEN}@github.com/${repo}.git`;
  try {
    execSync(`git remote set-url origin ${authUrl}`, { cwd: REPO_ROOT });
    execSync(`git add "${projectPath}"`, { cwd: REPO_ROOT });
    const commitResult = spawnSync("git", ["commit", "-m", `feat: 新增作品「${title}」`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (commitResult.status !== 0) return false;
    execSync(`git push origin ${currentBranch}`, { cwd: REPO_ROOT });
    return true;
  } catch {
    return false;
  } finally {
    execSync(`git remote set-url origin ${originUrl}`, { cwd: REPO_ROOT });
  }
}

/** 開新分支、push、用 API 開 PR。回傳 { prUrl, manualPrUrl }，失敗時 prUrl 為 null、manualPrUrl 為手動開 PR 連結。 */
async function createPrAndReply(title, slug) {
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
  const originUrl = remote;
  const authUrl = `https://x-access-token:${GITHUB_TOKEN}@github.com/${repo}.git`;
  try {
    execSync(`git remote set-url origin ${authUrl}`, { cwd: REPO_ROOT });
    execSync(`git checkout -b ${branchName}`, { cwd: REPO_ROOT });
    execSync(`git add "${projectPath}"`, { cwd: REPO_ROOT });
    const commitResult = spawnSync("git", ["commit", "-m", `feat: 新增作品「${title}」`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (commitResult.status !== 0) throw new Error(commitResult.stderr || commitResult.stdout || "git commit 失敗");
    execSync(`git push -u origin ${branchName}`, { cwd: REPO_ROOT });
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
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`腳本結束碼 ${code}\n${stderr || stdout}`));
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
  ];
  try {
    if (DISCORD_GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(appId, DISCORD_GUILD_ID), { body: commands });
      console.log("已註冊 Slash Command：/新作品（僅此伺服器，會立即出現）");
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
    const body = interaction.fields.getTextInputValue("body")?.trim() || "";
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
    };
    const reply = await message.reply("正在建立專案…").catch(() => null);
    const update = (text) => reply?.edit(text).catch(() => {});
    try {
      await runCreateProject(payload);
      await update(`✅ 已建立專案：\`${pending.title}\`\n正在優化圖片…`);
      await runOptimizeImages();
      let resultMsg = `✅ 已建立專案：\`${pending.title}\`，已執行 \`optimize-images\``;
      if (GITHUB_TOKEN) {
        const slug = slugify(pending.title);
        if (GITHUB_PUSH_DIRECT) {
          await update(`${resultMsg}\n正在 push…`);
          const ok = pushDirectToCurrentBranch(pending.title, slug);
          resultMsg += ok ? "\n已 **push** 到目前分支，部署會自動進行。" : "\n（push 失敗，請手動 push）";
        } else {
          await update(`${resultMsg}\n正在開 PR…`);
          try {
            const { prUrl, manualPrUrl } = await createPrAndReply(pending.title, slug);
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
      await update(`❌ 建立失敗：${err.message}`);
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
  };

  const reply = await message.reply("正在建立專案…").catch(() => null);
  const update = (text) => reply?.edit(text).catch(() => {});

  try {
    await runCreateProject(payload);
    await update(`✅ 已建立專案：\`${title}\`\n正在優化圖片…`);
    await runOptimizeImages();
    let resultMsg = `✅ 已建立專案：\`${title}\`，已執行 \`optimize-images\``;
    if (GITHUB_TOKEN) {
      const slug = slugify(title);
      if (GITHUB_PUSH_DIRECT) {
        await update(`${resultMsg}\n正在 push…`);
        const ok = pushDirectToCurrentBranch(title, slug);
        resultMsg += ok ? "\n已 **push** 到目前分支，部署會自動進行。" : "\n（push 失敗，請手動 push）";
      } else {
        await update(`${resultMsg}\n正在開 PR…`);
        try {
          const { prUrl, manualPrUrl } = await createPrAndReply(title, slug);
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
    await update(`❌ 建立失敗：${err.message}`);
  }
});

client.login(DISCORD_BOT_TOKEN).catch((err) => {
  console.error("登入失敗：", err.message);
  process.exit(1);
});
