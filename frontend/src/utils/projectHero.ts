import path from "node:path";
import { getWebpSize } from "./webpSize";

type WithSrc = { src?: string };
type WithPoster = { poster?: string };

/** 作品頁第一眼會顯示的圖：Reels／只有影片時用封面，其餘用輪播第一張 */
export function projectHeroSrc(data: {
	images?: WithSrc[] | null;
	image?: WithSrc | null;
	videos?: WithPoster[] | null;
	video?: WithPoster | null;
	tags?: string[] | null;
}): string | undefined {
	const poster = data.videos?.find((v) => v?.poster)?.poster ?? data.video?.poster;
	const fromImages = data.images?.find((img) => img?.src)?.src;
	const hasImage = Boolean(fromImages || data.image?.src);
	const videoFirst = Boolean(data.tags?.includes("reels") || !hasImage);
	if (videoFirst && poster) return poster;
	if (fromImages) return fromImages;
	if (data.image?.src) return data.image.src;
	return poster;
}

/** 站內 /projects/.../*.webp 的像素尺寸，用來在圖載入前留好高度 */
export function webpDimensions(src: string): { width: number; height: number } | null {
	const clean = src.split("?")[0] ?? "";
	if (!clean.startsWith("/projects/") || !clean.toLowerCase().endsWith(".webp")) return null;
	const rel = clean.slice("/projects/".length);
	if (!rel || rel.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
	try {
		return getWebpSize(path.join(process.cwd(), "src/content/projects", rel));
	} catch {
		return null;
	}
}
