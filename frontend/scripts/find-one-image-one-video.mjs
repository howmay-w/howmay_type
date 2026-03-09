#!/usr/bin/env node
/**
 * 找出所有「只有一張圖與一段影片」的專案
 * - 有 video（且 video 有 src）
 * - 圖只有一張：有 images 陣列且長度為 1，或沒有 images 但有單一 image 欄位
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectsDir = path.join(__dirname, "../src/content/projects");

const dirs = fs.readdirSync(projectsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const results = [];

for (const slug of dirs) {
  const indexPath = path.join(projectsDir, slug, "index.md");
  if (!fs.existsSync(indexPath)) continue;

  const raw = fs.readFileSync(indexPath, "utf-8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) continue;

  const front = match[1];

  // 有 video 且 video 有 src
  const hasVideo =
    /^video:\s*$/m.test(front) && /^video:[\s\S]*?^\s+src:\s+/m.test(front);

  // images 陣列裡的項目數（每一項是 "  - src:"）
  const imagesArrayMatches = front.match(/^images:\s*$[\s\S]*?(?=^[a-zA-Z]|\Z)/m);
  let imagesCount = 0;
  if (imagesArrayMatches) {
    const block = imagesArrayMatches[0];
    imagesCount = (block.match(/^\s+-\s+src:\s+/gm) || []).length;
  }

  // 有單一 image 欄位（沒有 images 陣列時用）
  const hasSingularImage = /^image:\s*$/m.test(front) && /^image:[\s\S]*?^\s+src:\s+/m.test(front);

  const oneImage =
    imagesCount === 1 || (imagesCount === 0 && hasSingularImage);

  if (hasVideo && oneImage) {
    results.push(slug);
  }
}

console.log("只有一張圖與一段影片的專案（共 " + results.length + " 個）：\n");
results.sort((a, b) => a.localeCompare(b, "zh-TW"));
results.forEach((slug) => console.log("  - " + slug));
