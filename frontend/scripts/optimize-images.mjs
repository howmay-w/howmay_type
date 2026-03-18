/**
 * 一次性將 src/content/projects/ 底下所有圖片：
 *   - 縮小至最大 1200px（長邊），grid 縮圖（media_0 / thumb）縮到 800px
 *   - 轉成 WebP（quality 82）
 *   - 輸出同路徑，副檔名改為 .webp
 *   - 轉檔成功後自動刪除原圖（.jpg / .jpeg / .png）
 *
 * 使用方式：
 *   node scripts/optimize-images.mjs
 *   node scripts/optimize-images.mjs --dry-run   (只列出不處理)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.resolve(__dirname, "../src/content/projects");
const DRY_RUN = process.argv.includes("--dry-run");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png"]);

// grid 縮圖用較小尺寸，其餘用較大尺寸
const THUMB_NAMES = new Set(["media_0", "thumb"]);
const THUMB_MAX = 800;
const DEFAULT_MAX = 1200;
const WEBP_QUALITY = 82;

let processed = 0;
let skipped = 0;
let errors = 0;

async function processImage(filePath) {
  const extActual = path.extname(filePath);       // 保留原始大小寫，如 .JPG
  const ext = extActual.toLowerCase();            // 用小寫來比對集合
  if (!IMAGE_EXT.has(ext)) return;

  const base = path.basename(filePath, extActual); // 用原始大小寫才能正確切掉
  const dir = path.dirname(filePath);
  const outPath = path.join(dir, `${base}.webp`);

  // 已存在 webp，且比原圖新 → 跳過；若原圖比 webp 新 → 重新產生
  if (fs.existsSync(outPath)) {
    const srcMtime = fs.statSync(filePath).mtimeMs;
    const webpMtime = fs.statSync(outPath).mtimeMs;
    if (srcMtime <= webpMtime) {
      skipped++;
      return;
    }
    // 原圖比 webp 新，刪掉舊 webp 重新產生
    if (!DRY_RUN) fs.unlinkSync(outPath);
  }

  const maxSize = THUMB_NAMES.has(base) ? THUMB_MAX : DEFAULT_MAX;

  if (DRY_RUN) {
    console.log(`[DRY] ${filePath} → ${outPath} (max ${maxSize}px)`);
    processed++;
    return;
  }

  try {
    // 限制解碼像素數，避免大圖在 Fly 等低記憶體環境 OOM（約 9MP 以內）
    const limitInputPixels = 3000 * 3000;
    await sharp(filePath, { limitInputPixels })
      .resize({ width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(outPath);

    const before = fs.statSync(filePath).size;
    const after = fs.statSync(outPath).size;
    const saving = (((before - after) / before) * 100).toFixed(1);
    console.log(
      `✓  ${path.relative(PROJECTS_DIR, filePath)}  ${fmt(before)} → ${fmt(after)} (-${saving}%)`
    );
    fs.unlinkSync(filePath);
    processed++;
  } catch (err) {
    console.error(`✗  ${filePath}: ${err.message}`);
    errors++;
  }
}

function fmt(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${(bytes / 1024).toFixed(0)}KB`;
}

async function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const fullPath = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(fullPath);
    } else if (e.isFile()) {
      await processImage(fullPath);
    }
  }
}

console.log(DRY_RUN ? "=== DRY RUN ===" : "=== 開始壓縮圖片 ===");
await walk(PROJECTS_DIR);
console.log(`\n完成：${processed} 張處理、${skipped} 張已跳過、${errors} 張錯誤`);
