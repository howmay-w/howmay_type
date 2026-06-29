/**
 * 批次修正作品內文：中英混排空間 +（近期作品）IG @/# 連結化
 * 用法：node frontend/scripts/fix-content-spacing-links.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, "../src/content/projects");
const DRY_RUN = process.argv.includes("--dry-run");
const LINKIFY_SINCE = "2025-01-01";

const PROTECT = [
  [/圖\d+/g, "FIG"],
  [/不ok/g, "BOK"],
  [/讀字fashion/g, "RFASH"],
  [/白水商號X橋/g, "BXQ"],
  [/的me:/g, "ME"],
  [/(?<=[\u4e00-\u9fff])qwq/gi, "QWQ"],
  [/(?<=[\u4e00-\u9fff])qq/gi, "QQ"],
  [/KLG快樂雞/g, "KLG"],
  [/館C728/g, "C728"],
];

function protect(text) {
  const map = new Map();
  let i = 0;
  for (const [re, prefix] of PROTECT) {
    text = text.replace(re, (m) => {
      const key = `__${prefix}${i++}__`;
      map.set(key, m);
      return key;
    });
  }
  return { text, map };
}

function unprotect(text, map) {
  for (const [key, val] of map) text = text.replaceAll(key, val);
  return text;
}

function fixCjkLatinSpacing(text) {
  if (!text) return text;
  const { text: protectedText, map } = protect(text);
  let out = protectedText.replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, "$1 $2");
  out = out.replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2");
  return unprotect(out, map);
}

function igProfileUrl(user) {
  return `https://www.instagram.com/${user}/`;
}

function igHashtagUrl(tag) {
  return `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(`#${tag}`)}`;
}

function linkifyInstagram(text) {
  if (!text) return text;
  let out = text.replace(/(?<!\[)@([a-zA-Z0-9._]+)/g, (_, user) => `[@${user}](${igProfileUrl(user)})`);
  out = out.replace(/(?<!\[)#([\p{L}\p{N}_]+)/gu, (_, tag) => `[#${tag}](${igHashtagUrl(tag)})`);
  return out;
}

function hasPlainIgMarkup(text) {
  return /(?<!\[)@[a-zA-Z0-9._]+/.test(text) || /(?<!\[)#[\p{L}\p{N}_]+/u.test(text);
}

function normalizeText(text, linkify) {
  let out = fixCjkLatinSpacing(text);
  if (linkify) out = linkifyInstagram(out);
  return out;
}

function parseMd(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  return { fm: m[1], body: m[2] };
}

function getPubDate(fm) {
  const m = fm.match(/^pubDate:\s*(\S+)/m);
  return m?.[1] ?? "0000-01-01";
}

function updateDescription(fm, linkify) {
  const m = fm.match(/^(description:\s*)(?:"([^"]*)"|'([^']*)'|([^\n]*))$/m);
  if (!m) return fm;
  const raw = m[2] ?? m[3] ?? m[4] ?? "";
  const next = normalizeText(raw, linkify);
  if (next === raw) return fm;
  const quoted = `"${next.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return fm.replace(m[0], `${m[1]}${quoted}`);
}

function main() {
  const changed = [];
  for (const slug of fs.readdirSync(PROJECTS_DIR).sort()) {
    const filePath = path.join(PROJECTS_DIR, slug, "index.md");
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseMd(raw);
    if (!parsed) continue;

    const pubDate = getPubDate(parsed.fm);
    const linkify =
      pubDate >= LINKIFY_SINCE &&
      (hasPlainIgMarkup(parsed.body) || hasPlainIgMarkup(parsed.fm));

    let fm = updateDescription(parsed.fm, linkify);
    const body = normalizeText(parsed.body, linkify);
    const out = `---\n${fm}\n---\n${body}`;

    if (out !== raw) {
      changed.push(slug);
      if (!DRY_RUN) fs.writeFileSync(filePath, out, "utf8");
    }
  }

  console.log(DRY_RUN ? "[dry-run] " : "", `已更新 ${changed.length} 篇：`);
  console.log(changed.join(", "));
}

main();
