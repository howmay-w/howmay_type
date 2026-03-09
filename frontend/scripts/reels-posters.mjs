/**
 * 為 reels 專案產生影片第一幀作為 poster，並寫入 index.md 的 video.poster 與 thumbnail。
 * 依賴：ffmpeg
 * 使用：node scripts/reels-posters.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.resolve(__dirname, "../src/content/projects");

const REELS_SLUGS = [
	"siān-siān",
	"仙草",
	"傷心",
	"傷腦筋",
	"大笨鳥",
	"富源",
	"數位藝術",
	"漂流",
	"漂釀",
	"無糖少冰",
	"臺灣",
	"藍銅礦",
	"觸",
	"邪說",
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

function extractPosterPath(src) {
	const match = src.match(/\/projects\/([^/]+)\/([^/]+)$/);
	if (!match) return null;
	const [, slug, filename] = match;
	const base = path.basename(filename, path.extname(filename));
	return { slug, posterFilename: `${base}_poster.jpg`, posterSrc: `/projects/${slug}/${base}_poster.jpg` };
}

function ensurePosterImage(projectDir, videoFilename, posterFilename) {
	const videoPath = path.join(projectDir, videoFilename);
	const posterPath = path.join(projectDir, posterFilename);
	if (!fs.existsSync(videoPath)) return false;
	if (fs.existsSync(posterPath)) return true;
	try {
		execSync(
			`ffmpeg -y -i "${videoPath}" -vframes 1 -q:v 2 "${posterPath}"`,
			{ stdio: "pipe", maxBuffer: 1024 * 1024 }
		);
		return true;
	} catch (_) {
		return false;
	}
}

function updateFrontmatter(content, posterSrc) {
	// 已有 poster 則只替換值
	if (content.includes("poster:")) {
		return content.replace(/poster:\s*"[^"]*"/, `poster: "${posterSrc}"`);
	}
	// video: 區塊：在 src 下一行插入 poster
	const afterVideoSrc = content.replace(
		/(\nvideo:\s*\n\s*src:\s*"[^"]*")/,
		`$1\n  poster: "${posterSrc}"`
	);
	if (afterVideoSrc !== content) return afterVideoSrc;
	// videos: 第一項（縮排 4 空格讓 poster 屬於該項）
	return content.replace(
		/(\nvideos:\s*\n\s*-\s*src:\s*"[^"]*")/,
		`$1\n    poster: "${posterSrc}"`
	);
}

function ensureThumbnail(content, posterSrc) {
	if (/^\s*thumbnail:\s*\n/m.test(content)) return content;
	return content.replace(
		/(\ntitle:\s*"[^"]*"\n)/,
		`$1thumbnail:\n  src: "${posterSrc}"\n  alt: ""\n`
	);
}

function main() {
	for (const slug of REELS_SLUGS) {
		const dir = path.join(PROJECTS_DIR, slug);
		const indexPath = path.join(dir, "index.md");
		if (!fs.existsSync(indexPath)) {
			console.warn(`Skip ${slug}: no index.md`);
			continue;
		}
		let content = fs.readFileSync(indexPath, "utf8");
		const videoSrc = getVideoSrc(content);
		if (!videoSrc) {
			console.warn(`Skip ${slug}: no video src`);
			continue;
		}
		const info = extractPosterPath(videoSrc);
		if (!info) continue;
		const videoFilename = path.basename(videoSrc);
		const created = ensurePosterImage(dir, videoFilename, info.posterFilename);
		if (!created) {
			console.warn(`Skip ${slug}: could not create poster (ffmpeg?)`);
			continue;
		}
		content = updateFrontmatter(content, info.posterSrc);
		if (!content.includes(`poster: "${info.posterSrc}"`)) {
			console.warn(`Skip ${slug}: could not add poster to frontmatter`);
			continue;
		}
		// 縮圖：用影片第一幀（若尚無 thumbnail）
		if (!/^\s*thumbnail:\s*$/m.test(content)) {
			content = ensureThumbnail(content, info.posterSrc);
		}
		fs.writeFileSync(indexPath, content, "utf8");
		console.log(`OK ${slug}: poster=${info.posterFilename}`);
	}
}

main();
