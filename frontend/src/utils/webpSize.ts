import fs from "node:fs";

/** 讀 WebP 檔頭取得寬高（支援 VP8 / VP8L / VP8X），不需要載入影像處理套件。 */
export function getWebpSize(file: string): { width: number; height: number } | null {
	const b = fs.readFileSync(file);
	if (b.length < 30) return null;
	if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
	const chunk = b.toString("ascii", 12, 16);
	if (chunk === "VP8X") {
		return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
	}
	if (chunk === "VP8L") {
		const bits = b.readUInt32LE(21);
		return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
	}
	if (chunk === "VP8 ") {
		return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
	}
	return null;
}
