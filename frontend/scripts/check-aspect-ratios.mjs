/**
 * 列出「同時有圖片與影片、且圖與影片比例不一致」的專案。
 * 例如圖片 1:1、影片 9:16 會列出。
 *
 * 依賴：sharp（已有）、ffprobe（ffmpeg，需已安裝）
 * 使用：node scripts/check-aspect-ratios.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.resolve(__dirname, "../src/content/projects");

// 從 /projects/slug/filename 得到專案資料夾路徑與檔名
function pathToFs(relativePath) {
  const match = relativePath.match(/^\/projects\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const [, slug, filename] = match;
  return path.join(PROJECTS_DIR, slug, filename);
}

function parseFrontmatter(content) {
  const firstImageSrc =
    content.match(/\nimage:\s*\n\s*src:\s*"([^"]+)"/)?.[1] ??
    content.match(/\nimages:\s*\n\s*-\s*src:\s*"([^"]+)"/)?.[1];
  const firstVideoSrc =
    content.match(/\nvideo:\s*\n\s*src:\s*"([^"]+)"/)?.[1] ??
    content.match(/\nvideos:\s*\n\s*-\s*src:\s*"([^"]+)"/)?.[1];
  return { firstImageSrc, firstVideoSrc };
}

async function getImageAspect(filePath) {
  try {
    const meta = await sharp(filePath).metadata();
    if (meta.width && meta.height) return meta.width / meta.height;
  } catch (_) {}
  return null;
}

function getVideoSize(filePath) {
  try {
    const out = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${filePath}"`,
      { encoding: "utf8", maxBuffer: 1024 * 1024 }
    ).trim();
    const [w, h] = out.split(",").map(Number);
    if (w && h) return { width: w, height: h };
  } catch (_) {}
  return null;
}

function getVideoAspect(filePath) {
  const size = getVideoSize(filePath);
  if (!size) return null;
  return size.width / size.height;
}

function ratioLabel(ratio) {
  const r = Math.round(ratio * 100) / 100;
  if (Math.abs(r - 1) < 0.05) return "1:1";
  if (Math.abs(r - 9 / 16) < 0.05) return "9:16";
  if (Math.abs(r - 16 / 9) < 0.05) return "16:9";
  if (Math.abs(r - 4 / 5) < 0.05) return "4:5";
  if (Math.abs(r - 5 / 4) < 0.05) return "5:4";
  if (Math.abs(r - 3 / 4) < 0.05) return "3:4";
  if (Math.abs(r - 4 / 3) < 0.05) return "4:3";
  return `${r.toFixed(2)}`;
}

// 比例視為一致若差異小於此（避免浮點誤差）
const RATIO_TOLERANCE = 0.08;

async function main() {
  const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  const inconsistent = [];
  let noFfprobe = false;

  for (const d of dirs) {
    const slug = d.name;
    const indexPath = path.join(PROJECTS_DIR, slug, "index.md");
    if (!fs.existsSync(indexPath)) continue;

    const content = fs.readFileSync(indexPath, "utf8");
    const { firstImageSrc, firstVideoSrc } = parseFrontmatter(content);
    if (!firstImageSrc || !firstVideoSrc) continue;

    const imagePath = pathToFs(firstImageSrc);
    const videoPath = pathToFs(firstVideoSrc);
    if (!imagePath || !videoPath) continue;
    if (!fs.existsSync(imagePath) || !fs.existsSync(videoPath)) continue;

    const imgAspect = await getImageAspect(imagePath);
    const vidAspect = getVideoAspect(videoPath);

    if (imgAspect == null) continue;
    if (vidAspect == null) {
      noFfprobe = true;
      continue;
    }

    const diff = Math.abs(imgAspect - vidAspect);
    if (diff > RATIO_TOLERANCE) {
      inconsistent.push({
        slug,
        imageRatio: imgAspect,
        videoRatio: vidAspect,
        imageLabel: ratioLabel(imgAspect),
        videoLabel: ratioLabel(vidAspect),
      });
    }
  }

  if (noFfprobe) {
    console.log("注意：部分專案無法讀取影片尺寸（請確認已安裝 ffmpeg/ffprobe）\n");
  }

  if (inconsistent.length === 0) {
    console.log("未發現圖與影片比例不一致的專案。");
    return;
  }

  console.log(`共 ${inconsistent.length} 個專案圖與影片比例不一致：\n`);
  for (const p of inconsistent) {
    console.log(`  ${p.slug}`);
    console.log(`    圖片約 ${p.imageLabel}、影片約 ${p.videoLabel}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
