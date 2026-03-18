/**
 * 從一份 JSON payload 建立新作品資料夾與 index.md，並可從 URL 或本機路徑下載／複製媒體。
 * 供 Discord Bot、Webhook 或手動流程呼叫，完成後請在 frontend 目錄執行 pnpm optimize-images。
 *
 * 使用方式：
 *   node scripts/create-project-from-payload.mjs payload.json
 *   node scripts/create-project-from-payload.mjs < payload.json   (從 stdin 讀)
 *
 * payload.json 格式見下方 PAYLOAD_SCHEMA。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.resolve(__dirname, "../src/content/projects");

/**
 * Payload 格式（可來自 Discord Bot、Webhook、手動編輯）：
 * {
 *   "title": "作品標題",           // 必填
 *   "description": "一句話描述",  // 選填
 *   "body": "Markdown 內文",      // 選填，預設空
 *   "tags": ["標籤A", "標籤B"],  // 選填
 *   "pubDate": "2025-01-01",      // 選填，YYYY-MM-DD
 *   "slug": "url-slug",           // 選填，不填則由 title 自動產生
 *   "images": [                   // 選填，順序即輪播順序
 *     { "url": "https://..." } 或 { "path": "/tmp/media_0.jpg" },
 *     { "url": "...", "alt": "圖 2" }
 *   ],
 *   "videos": [                   // 選填
 *     { "url": "https://...", "posterUrl": "https://..." } 或 { "path": "/tmp/v.mp4", "posterPath": "/tmp/p.jpg" }
 *   ],
 *   "hoverVideoIndex": 0,         // 選填，用第幾個影片當 hover（預設 0）
 *   "overwrite": true,            // 選填，若為 true 且同 slug 專案已存在則清空後覆寫
 *   "onlyUpdateBody": true        // 選填，若為 true 僅更新該專案 index.md 的內文／標題／描述／標籤，不碰圖片
 * }
 */

function slugify(title) {
  return title
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "untitled";
}

async function downloadOrCopy(src, dest) {
  if (src.path) {
    fs.copyFileSync(src.path, dest);
    return;
  }
  const url = src.url;
  if (!url) throw new Error("image/video 需提供 url 或 path");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載失敗 ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function escapeYamlString(s) {
  if (s == null || s === "") return "";
  const str = String(s);
  if (str.includes("\n") || str.includes(":") || str.includes('"')) return `"${str.replace(/"/g, '\\"')}"`;
  return str;
}

/** 清空目錄內所有檔案與子目錄（不刪除目錄本身） */
function clearDir(dir) {
  const names = fs.readdirSync(dir);
  for (const name of names) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      clearDir(full);
      fs.rmdirSync(full);
    } else {
      fs.unlinkSync(full);
    }
  }
}

/** 僅更新現有專案的 index.md：內文與可選的 title / description / tags */
function updateProjectBodyOnly(projectDir, payload) {
  const indexPath = path.join(projectDir, "index.md");
  if (!fs.existsSync(indexPath)) {
    console.error(`找不到 ${indexPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(indexPath, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    console.error("無法解析 index.md 的 frontmatter");
    process.exit(1);
  }
  let fm = match[1];
  const body = typeof payload.body === "string" ? payload.body.trim() : (match[2] || "").trim();
  if (payload.title != null && payload.title !== "") {
    fm = fm.replace(/^title:\s*.*$/m, `title: ${escapeYamlString(payload.title)}`);
  }
  if (payload.description !== undefined) {
    if (fm.includes("description:")) {
      fm = fm.replace(/^description:\s*.*$/m, `description: ${escapeYamlString(payload.description)}`);
    } else {
      fm = fm.trimEnd() + `\ndescription: ${escapeYamlString(payload.description)}`;
    }
  }
  if (payload.tags && Array.isArray(payload.tags)) {
    const tagsLine = `tags: [${payload.tags.map((t) => `"${String(t).replace(/"/g, '\\"')}"`).join(", ")}]`;
    if (fm.includes("tags:")) {
      fm = fm.replace(/^tags:\s*\[[\s\S]*?\]/m, tagsLine);
    } else {
      fm = fm.trimEnd() + `\n${tagsLine}`;
    }
  }
  const out = `---\n${fm}\n---\n\n${body}\n`;
  fs.writeFileSync(indexPath, out, "utf8");
  console.log(`已更新內文：${projectDir}`);
  console.log("STATUS: updated");
}

async function main() {
  const input = process.argv[2]
    ? fs.readFileSync(process.argv[2], "utf8")
    : await new Promise((resolve, reject) => {
        const chunks = [];
        process.stdin.on("data", (chunk) => chunks.push(chunk));
        process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        process.stdin.on("error", reject);
      });

  const payload = JSON.parse(input);
  const title = payload.title;
  if (!title) {
    console.error("payload 需包含 title");
    process.exit(1);
  }

  const slug = payload.slug || slugify(title);
  const projectDir = path.join(PROJECTS_DIR, slug);

  if (payload.onlyUpdateBody) {
    if (!fs.existsSync(projectDir)) {
      console.error(`專案不存在，無法僅更新內文: ${projectDir}`);
      process.exit(1);
    }
    updateProjectBodyOnly(projectDir, payload);
    return;
  }

  let overwritten = false;
  if (fs.existsSync(projectDir)) {
    if (!payload.overwrite) {
      console.error(`資料夾已存在: ${projectDir}`);
      process.exit(1);
    }
    clearDir(projectDir);
    overwritten = true;
  } else {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const images = payload.images || [];
  const videos = payload.videos || [];
  const basePath = `/projects/${slug}`;

  // 下載／複製圖片 → media_0.jpg, media_1.jpg ...（之後跑 optimize-images 會變成 .webp）
  for (let i = 0; i < images.length; i++) {
    const ext = images[i].path ? path.extname(images[i].path).toLowerCase() || ".jpg" : ".jpg";
    const dest = path.join(projectDir, `media_${i}${ext}`);
    await downloadOrCopy(images[i], dest);
  }

  // 下載／複製影片 → video_0.mp4，poster → video_0_poster.jpg
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    const ext = v.path ? path.extname(v.path).toLowerCase() || ".mp4" : ".mp4";
    const videoDest = path.join(projectDir, `video_${i}${ext}`);
    await downloadOrCopy({ url: v.url, path: v.path }, videoDest);
    if (v.posterUrl || v.posterPath) {
      const posterExt = v.posterPath ? path.extname(v.posterPath).toLowerCase() || ".jpg" : ".jpg";
      const posterDest = path.join(projectDir, `video_${i}_poster${posterExt}`);
      await downloadOrCopy({ url: v.posterUrl, path: v.posterPath }, posterDest);
    }
  }

  // 產出時圖片路徑用 .webp（跑完 optimize-images 後會是 webp；若尚未跑則先寫 .jpg 讓你先預覽再跑）
  const imageExt = images.length > 0 ? ".webp" : ".jpg";
  const imagePaths = images.map((img, i) => ({
    src: `${basePath}/media_${i}${imageExt}`,
    alt: img.alt || `圖 ${i + 1}`,
  }));

  const videoPaths = videos.map((v, i) => {
    const ext = v.path ? path.extname(v.path).toLowerCase() || ".mp4" : ".mp4";
    const posterExt = ".webp";
    const out = {
      src: `${basePath}/video_${i}${ext}`,
      poster: v.posterUrl || v.posterPath ? `${basePath}/video_${i}_poster${posterExt}` : undefined,
    };
    return out;
  });

  const hoverIndex = payload.hoverVideoIndex ?? 0;
  const firstImage = imagePaths[0];
  const firstVideo = videoPaths[0];

  const frontmatter = {
    title: escapeYamlString(title),
    ...(payload.description && { description: escapeYamlString(payload.description) }),
    ...(payload.pubDate && { pubDate: payload.pubDate }),
    ...(payload.tags?.length && { tags: payload.tags }),
    ...(firstImage && { image: { src: firstImage.src, alt: firstImage.alt } }),
    ...(imagePaths.length > 0 && { images: imagePaths }),
    ...(firstVideo && {
      video: firstVideo.poster ? { src: firstVideo.src, poster: firstVideo.poster } : { src: firstVideo.src },
    }),
    ...(videoPaths.length > 1 && {
      videos: videoPaths.map((v) => (v.poster ? { src: v.src, poster: v.poster } : { src: v.src })),
    }),
    ...(firstVideo && {
      hoverVideo: { src: videoPaths[hoverIndex]?.src ?? firstVideo.src },
    }),
  };

  const yamlLines = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;
    if (key === "tags") {
      yamlLines.push(`tags: [${value.map((t) => `"${String(t).replace(/"/g, '\\"')}"`).join(", ")}]`);
    } else if (typeof value === "object" && !Array.isArray(value) && value.src) {
      yamlLines.push(`${key}:`);
      yamlLines.push(`  src: "${value.src}"`);
      if (value.alt) yamlLines.push(`  alt: "${String(value.alt).replace(/"/g, '\\"')}"`);
      if (value.poster) yamlLines.push(`  poster: "${value.poster}"`);
    } else if (Array.isArray(value)) {
      yamlLines.push(`${key}:`);
      for (const item of value) {
        if (item.src) {
          yamlLines.push(`  - src: "${item.src}"`);
          if (item.alt) yamlLines.push(`    alt: "${String(item.alt).replace(/"/g, '\\"')}"`);
          if (item.poster) yamlLines.push(`    poster: "${item.poster}"`);
        }
      }
    } else {
      yamlLines.push(`${key}: ${typeof value === "string" ? escapeYamlString(value) : value}`);
    }
  }

  const body = (payload.body || "").trim();
  const indexMd = `---\n${yamlLines.join("\n")}\n---\n\n${body}\n`;
  fs.writeFileSync(path.join(projectDir, "index.md"), indexMd, "utf8");

  console.log(overwritten ? `已覆寫：${projectDir}` : `已建立：${projectDir}`);
  console.log("請在 frontend 目錄執行：pnpm optimize-images");
  console.log(overwritten ? "STATUS: overwritten" : "STATUS: created");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
