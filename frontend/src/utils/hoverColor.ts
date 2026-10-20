// 字牆 hover 顏色：原作字色太暗時保留色相、把亮度拉高，黑底上才看得到。
// 用 OKLCH 計算（亮度接近人眼感受）；超出 sRGB 色域時降低彩度。
// 原本彩度就很低的顏色（黑、灰、掃描稿帶一點色偏的近黑）提亮後會放大雜色，回傳 undefined 交給後備色。

const KEEP_L = 0.6; // 這個亮度以上的顏色在黑底上看得清楚，照原樣使用
const LIFT_L = 0.72; // 太暗的顏色提亮到這個亮度
const MIN_C = 0.05; // 原本至少要有這麼多彩度，才算「有顏色」

type Lch = { l: number; c: number; h: number };

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

function hexToOklch(hex: string): Lch | null {
	const m = hex.match(/^#([0-9a-f]{6})$/i);
	if (!m) return null;
	const [r, g, b] = [0, 2, 4].map((i) => toLinear(parseInt(m[1].slice(i, i + 2), 16) / 255));
	const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
	const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
	return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

function oklchToRgb({ l, c, h }: Lch) {
	const A = c * Math.cos(h);
	const B = c * Math.sin(h);
	const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
	return [
		4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707626953 * s_,
	];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
const toHex = (rgb: number[]) =>
	`#${rgb
		.map((v) => Math.round(Math.min(1, Math.max(0, fromLinear(v))) * 255).toString(16).padStart(2, "0"))
		.join("")}`;

export function hoverColor(hex: string | undefined): string | undefined {
	if (!hex) return undefined;
	const lch = hexToOklch(hex);
	if (!lch) return undefined;
	if (lch.l >= KEEP_L) return hex;
	if (lch.c < MIN_C) return undefined;
	// 拉高亮度，彩度跟著等比例放大（深紅提亮後還是紅，不會變成粉色）；超出色域就逐步降低
	const lifted = { l: LIFT_L, c: (lch.c * LIFT_L) / Math.max(lch.l, 0.05), h: lch.h };
	while (lifted.c > 0 && !inGamut(oklchToRgb(lifted))) lifted.c -= 0.005;
	return toHex(oklchToRgb(lifted));
}
