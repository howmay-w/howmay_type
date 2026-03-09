/**
 * 將指定 reels 專案的影片 poster 改為最後一幀（覆寫既有 poster 圖檔）。
 * 依賴：ffmpeg
 * 使用：node scripts/reels-poster-last-frame.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.resolve(__dirname, "../src/content/projects");

// 要改為「最後一幀」的 reels 專案（排除：邪說、仙草、漂流、無糖少冰、傷心）
const REELS_USE_LAST_FRAME = [
	"siān-siān",
	"傷腦筋",
	"大笨鳥",
	"富源",
	"數位藝術",
	"漂釀",
	"臺灣",
	"藍銅礦",
	"觸",
	"野生",
	"金牛座",
	"魑魅魍魎",
];

function getVideoSrc(content) {
	const m = content.match(/\nvideo:\s*\n\s*src:\s*"([^"]+)"/);
	if (m) return m[1];
	const m2 = content.match(/\nvideos:\s*\n\s*-\s*src:\s*"([^"]+)"/);
	return m2?.[1] ?? null;
}

function getVideoAndPosterPath(src) {
	const match = src.match(/\/projects\/([^/]+)\/([^/]+)$/);
	if (!match) return null;
	const [, slug, filename] = match;
	const base = path.basename(filename, path.extname(filename));
	return { videoFilename: filename, posterFilename: `${base}_poster.jpg` };
}

function getDurationSeconds(videoPath) {
	try {
		const out = execFileSync(
			"ffprobe",
			[
				"-v", "error",
				"-show_entries", "format=duration",
				"-of", "default=noprint_wrappers=1:nokey=1",
				videoPath,
			],
			{ encoding: "utf8", maxBuffer: 65536 }
		).trim();
		return parseFloat(out, 10);
	} catch (_) {
		return NaN;
	}
}

function extractLastFrame(projectDir, videoFilename, posterPath) {
	const videoPath = path.join(projectDir, videoFilename);
	if (!fs.existsSync(videoPath)) return false;
	try {
		const dur = getDurationSeconds(videoPath);
		if (!Number.isFinite(dur) || dur < 0.1) {
			execFileSync(
				"ffmpeg",
				["-y", "-i", videoPath, "-vframes", "1", "-q:v", "2", "-strict", "unofficial", posterPath],
				{ stdio: "pipe", maxBuffer: 1024 * 1024 }
			);
			return true;
		}
		const seek = Math.max(0, dur - 0.2);
		execFileSync(
			"ffmpeg",
			["-y", "-ss", String(seek), "-i", videoPath, "-vframes", "1", "-q:v", "2", "-strict", "unofficial", posterPath],
			{ stdio: "pipe", maxBuffer: 1024 * 1024 }
		);
		return true;
	} catch (_) {
		return false;
	}
}

function main() {
	for (const slug of REELS_USE_LAST_FRAME) {
		const dir = path.join(PROJECTS_DIR, slug);
		const indexPath = path.join(dir, "index.md");
		if (!fs.existsSync(indexPath)) {
			console.warn(`Skip ${slug}: no index.md`);
			continue;
		}
		const content = fs.readFileSync(indexPath, "utf8");
		const videoSrc = getVideoSrc(content);
		if (!videoSrc) {
			console.warn(`Skip ${slug}: no video src`);
			continue;
		}
		const info = getVideoAndPosterPath(videoSrc);
		if (!info) continue;
		const posterPath = path.join(dir, info.posterFilename);
		const ok = extractLastFrame(dir, info.videoFilename, posterPath);
		console.log(ok ? `OK ${slug}: poster → 最後一幀` : `Fail ${slug}`);
	}
}

main();
