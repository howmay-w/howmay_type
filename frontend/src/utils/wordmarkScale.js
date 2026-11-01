/**
 * 字牆的新規則，只套用在 NEW_RULES_SINCE 當天以後發表的作品；之前的作品維持原本公式與手動倍率。
 * ProjectCard.astro 與字圖管理頁（wordmark-admin.html）共用這支。
 *
 * 1. 字數上限：超過五個字的作品都會換行排，從標題推算的字數最多算 5.5（手動填的字數不受限）
 * 2. 自動倍率：依字數、墨量、長寬比補正「量感公式」排出來偏小的作品。
 *    係數是用 2026-10 時 280 件字圖的手動倍率擬合出來的（log 倍率的最小平方法）：
 *    字越少越要放大（單字作品最明顯）、筆畫越細越要放大、長寬比越極端（很寬或很長）越不用放大。
 *    手動倍率 wordmark.scale 再乘在這之上，只做最後微調。
 */
export const NEW_RULES_SINCE = "2026-11-01";
const INK_REF = 0.3;
const MAX_CHARS = 5.5;

/** pubDate：Date 或 YYYY-MM-DD 字串 */
export function isNewRules(pubDate) {
  if (!pubDate) return false;
  const iso = pubDate instanceof Date ? pubDate.toISOString().slice(0, 10) : String(pubDate).slice(0, 10);
  return iso >= NEW_RULES_SINCE;
}

/** 從標題推算的字數，套上新作品的上限 */
export function cappedChars(counted, pubDate) {
  return isNewRules(pubDate) ? Math.min(MAX_CHARS, counted) : counted;
}

export function autoScale({ chars, ink, aspect, pubDate }) {
  if (!isNewRules(pubDate)) return 1;
  const k = Math.min(0.8, Math.max(0.08, ink ?? INK_REF));
  return 1.168 * Math.max(1, chars) ** -0.074 * (k / INK_REF) ** -0.051 * Math.exp(-0.086 * Math.abs(Math.log(aspect)));
}
