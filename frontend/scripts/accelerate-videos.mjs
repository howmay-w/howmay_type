/**
 * 將 src/content/projects/ 底下過長的 hover 影片加速，與 hoverVideo.js 區間一致：
 *   7–10s → 1.5x
 *   10–15s → 2x
 *   15–20s → 2.5x
 *   20s+ → 3x
 *
 * 需安裝 ffmpeg：brew install ffmpeg
 *
 * 使用方式：
 *   node scripts/accelerate-videos.mjs
 *   node scripts/accelerate-videos.mjs --dry-run   (只列出不處理)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.resolve(__dirname, "../src/content/projects");
const DRY_RUN = process.argv.includes("--dry-run");

function getDuration(filePath) {
  try {
    const out = execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { encoding: "utf8" });
    return parseFloat(out.trim());
  } catch {
    return null;
  }
}

function getSpeedMultiplier(duration) {
  if (duration < 7) return 1;
  if (duration < 10) return 1.5;
  if (duration < 15) return 2;
  if (duration < 20) return 2.5;
  return 3;
}

function accelerateVideo(srcPath, speed) {
  if (speed <= 1) return;
  const dir = path.dirname(srcPath);
  const tmpPath = path.join(dir, `_accel_${path.basename(srcPath)}`);
  const setpts = (1 / speed).toFixed(4);
  try {
    execFileSync("ffmpeg", [
      "-y",
      "-i",
      srcPath,
      "-filter:v",
      `setpts=${setpts}*PTS`,
      "-an",
      "-movflags",
      "+faststart",
      tmpPath,
    ], { stdio: "pipe" });
    fs.renameSync(tmpPath, srcPath);
  } catch (err) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    throw err;
  }
}

function main() {
  const ffmpegCheck = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (ffmpegCheck.status !== 0) {
    console.error("請先安裝 ffmpeg：brew install ffmpeg");
    process.exit(1);
  }

  const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let processed = 0;
  for (const slug of dirs) {
    const videoPath = path.join(PROJECTS_DIR, slug, "video_0.mp4");
    if (!fs.existsSync(videoPath)) continue;

    const indexPath = path.join(PROJECTS_DIR, slug, "index.md");
    if (!fs.existsSync(indexPath)) continue;
    const indexContent = fs.readFileSync(indexPath, "utf8");
    if (!indexContent.includes("hoverVideo:")) continue;

    const dur = getDuration(videoPath);
    if (dur == null || dur < 7) continue;

    const speed = getSpeedMultiplier(dur);
    if (speed <= 1) continue;

    const newDur = (dur / speed).toFixed(1);
    console.log(`${slug}: ${dur.toFixed(1)}s → ${speed}x → ${newDur}s`);

    if (!DRY_RUN) {
      accelerateVideo(videoPath, speed);
      processed++;
    }
  }

  if (DRY_RUN) {
    console.log("\n(dry-run，未實際修改檔案)");
  } else {
    console.log(`\n已處理 ${processed} 支影片`);
  }
}

main();
