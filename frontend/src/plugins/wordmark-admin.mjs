/**
 * 字圖管理頁（只在 dev server 提供，build 不會包含）：
 * - GET  /__wordmarks             管理頁
 * - GET  /__wordmarks/compare-scale  字牆空隙比較（原本／先縮再排／加大間距三欄並排，可調倍率與寬度）
 * - GET  /__wordmarks/editor      精修視窗（wordmark-editor/，以 iframe 疊在管理頁上）
 * - GET  /__wordmarks/api/list    所有作品的字圖資料
 * - POST /__wordmarks/api/update  修改字圖欄位（hidden / scale / chars / redo / needsImage）
 * - POST /__wordmarks/api/replace?slug=&v=&ink=  上傳處理好的 webp，取代該款字圖；v 等於現有款數時新增一款
 * - POST /__wordmarks/api/source?slug=&v=  換圖時上傳的原始圖，存成 wordmark-source*.webp，之後精修以它為原圖（不會進正式網站）
 * - POST /__wordmarks/api/remove  刪除其他款字圖（主字圖不能刪，只能隱藏）
 * v 是第幾款：0 = 主字圖（index.md 的 wordmark 區塊、wordmark.webp），
 * 1 起 = 其他款（extraWordmarks 清單、wordmark-2.webp、wordmark-3.webp…）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentProjects = path.resolve(__dirname, "../content/projects");
const pageFile = path.join(__dirname, "wordmark-admin.html");
// 精修視窗（以 iframe 疊在管理頁上），程式在 wordmark-editor/，由 Vite 轉譯
const editorFile = path.join(__dirname, "wordmark-editor", "editor.html");
const compareFile = path.join(__dirname, "wordmark-compare.html");
const EDITABLE = new Set(["reviewed", "hidden", "scale", "chars", "redo", "needsImage"]);

function webpSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF") return null;
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  return null;
}

// 解析 / 寫回 index.md 裡的 wordmark 區塊（每行「  key: JSON 值」）
const BLOCK_RE = /^wordmark:\n((?:[ \t]+.*\n)*)/m;
function readWordmark(md) {
  const m = md.match(BLOCK_RE);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^\s+(\w+):\s*(.*)$/);
    if (!kv) continue;
    try {
      out[kv[1]] = JSON.parse(kv[2]);
    } catch {
      out[kv[1]] = kv[2];
    }
  }
  return out;
}
const ORDER = ["src", "source", "sourceImage", "accent", "ink", "chars", "size", "scale", "hidden", "redo", "needsImage", "reviewed"];
function writeWordmark(md, fields) {
  const keys = [...ORDER.filter((k) => k in fields), ...Object.keys(fields).filter((k) => !ORDER.includes(k))];
  const block = `wordmark:\n${keys.map((k) => `  ${k}: ${JSON.stringify(fields[k])}\n`).join("")}`;
  if (BLOCK_RE.test(md)) return md.replace(BLOCK_RE, block);
  const end = md.indexOf("\n---", 4);
  return `${md.slice(0, end + 1)}${block}${md.slice(end + 1)}`;
}
// 其他款字圖：extraWordmarks 清單，每款一行「  - {JSON}」（YAML 的流式寫法）
const EXTRA_RE = /^extraWordmarks:\n((?:[ \t]+.*\n)*)/m;
function readExtras(md) {
  const m = md.match(EXTRA_RE);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((line) => line.match(/^\s+-\s*(\{.*\})\s*$/)?.[1])
    .filter(Boolean)
    .map((j) => JSON.parse(j));
}
function writeExtras(md, list) {
  const sorted = list.map((f) => Object.fromEntries([...ORDER.filter((k) => k in f), ...Object.keys(f).filter((k) => !ORDER.includes(k))].map((k) => [k, f[k]])));
  const block = list.length ? `extraWordmarks:\n${sorted.map((f) => `  - ${JSON.stringify(f)}\n`).join("")}` : "";
  if (EXTRA_RE.test(md)) return md.replace(EXTRA_RE, block);
  if (!block) return md;
  // 接在 wordmark 區塊後面；沒有的話放在 front matter 最後
  const wm = md.match(BLOCK_RE);
  if (wm) return md.replace(BLOCK_RE, `${wm[0]}${block}`);
  const end = md.indexOf("\n---", 4);
  return `${md.slice(0, end + 1)}${block}${md.slice(end + 1)}`;
}
// 讀寫第 v 款
const readVariant = (md, v) => (v === 0 ? readWordmark(md) : (readExtras(md)[v - 1] ?? null));
function writeVariant(md, v, fields) {
  if (v === 0) return writeWordmark(md, fields);
  const list = readExtras(md);
  list[v - 1] = fields;
  return writeExtras(md, list);
}
// 新增一款時的檔名：wordmark-2.webp、wordmark-3.webp…，挑沒用過的號碼
function newExtraName(dir, md) {
  const used = new Set(readExtras(md).map((f) => path.basename(f.src)));
  for (let n = 2; ; n++) {
    const name = `wordmark-${n}.webp`;
    if (!used.has(name) && !fs.existsSync(path.join(dir, name))) return name;
  }
}
const sourceNameOf = (file) => file.replace(/^wordmark/, "wordmark-source");
const variantOf = (v) => {
  const n = parseInt(v ?? "0", 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

const frontValue = (md, key) => md.match(new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, "m"))?.[1];
const firstImage = (md) =>
  md.match(/^(?:thumbnail|image):\s*\n\s+src:\s*"?([^"\n]+)"?/m)?.[1] ??
  md.match(/^images:\s*\n\s+-\s+src:\s*"?([^"\n]+)"?/m)?.[1];

function fallbackImage(slug) {
  const f = fs
    .readdirSync(path.join(contentProjects, slug))
    .filter((n) => /^media_\d+\.(webp|jpe?g|png)$/i.test(n))
    .sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6)))[0];
  return f ? `/projects/${slug}/${f}` : null;
}

// 管理頁的清單：每一款字圖是一筆（key = slug#v），其他款的標題加上「第 n 款」
function listProjects() {
  return fs
    .readdirSync(contentProjects, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(contentProjects, d.name, "index.md")))
    .flatMap((d) => {
      const slug = d.name;
      const dir = path.join(contentProjects, slug);
      const md = fs.readFileSync(path.join(dir, "index.md"), "utf8");
      const mdTime = fs.statSync(path.join(dir, "index.md")).mtimeMs;
      const title = frontValue(md, "title") ?? slug;
      const base = {
        slug,
        title,
        date: frontValue(md, "pubDate") ?? "",
        // 原圖：作品資料登記的第一張圖；只有影片的作品（例如「讀字」）改用資料夾裡的 media_*.webp
        post: firstImage(md) ?? fallbackImage(slug),
      };
      const variants = [readWordmark(md), ...readExtras(md)];
      const total = variants.filter(Boolean).length;
      return variants.map((wordmark, v) => {
        const file = path.join(dir, wordmark?.src ? path.basename(wordmark.src) : "wordmark.webp");
        const exists = fs.existsSync(file);
        const mtime = exists ? fs.statSync(file).mtimeMs : 0;
        return {
          ...base,
          key: `${slug}#${v}`,
          v,
          total,
          file: path.basename(file),
          wordmark,
          size: exists ? webpSize(file) : null,
          bytes: exists ? fs.statSync(file).size : 0,
          mtime,
          // 最近編輯：index.md 或字圖最後修改的時間（管理頁「最近編輯」排序用）
          edited: Math.max(mdTime, mtime),
        };
      });
    });
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
const send = (res, status, body, type = "application/json") => {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
// 只接受實際存在的作品資料夾名稱，避免路徑跳出 content/projects
const projectDir = (slug) => {
  if (!slug || slug.includes("/") || slug.includes("\\") || slug.startsWith(".")) return null;
  const dir = path.join(contentProjects, slug);
  return fs.existsSync(path.join(dir, "index.md")) ? dir : null;
};

export function wordmarkAdminPlugin() {
  return {
    name: "wordmark-admin",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__wordmarks", async (req, res) => {
        try {
          // 讓本機的 wut-collage-tool（字牆模式）可以直接讀清單、送回換圖；只接受 localhost 來源
          const origin = req.headers.origin;
          if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type");
            res.setHeader("Vary", "Origin");
          }
          if (req.method === "OPTIONS") {
            res.statusCode = 204;
            return res.end();
          }
          const url = new URL(req.url ?? "/", "http://localhost");
          if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
            return send(res, 200, fs.readFileSync(pageFile, "utf8"), "text/html; charset=utf-8");
          }
          if (req.method === "GET" && url.pathname === "/compare-scale") {
            return send(res, 200, fs.readFileSync(compareFile, "utf8"), "text/html; charset=utf-8");
          }
          if (req.method === "GET" && url.pathname === "/editor") {
            return send(res, 200, fs.readFileSync(editorFile, "utf8"), "text/html; charset=utf-8");
          }
          if (req.method === "GET" && url.pathname === "/api/list") return send(res, 200, listProjects());

          if (req.method === "POST" && url.pathname === "/api/update") {
            const { slug, v: rawV, fields } = JSON.parse((await readBody(req)).toString("utf8"));
            const v = variantOf(rawV);
            const dir = projectDir(slug);
            if (!dir) return send(res, 404, { error: "找不到作品" });
            const mdFile = path.join(dir, "index.md");
            const md = fs.readFileSync(mdFile, "utf8");
            const current = readVariant(md, v);
            if (!current) return send(res, 400, { error: "這件作品還沒有字圖" });
            for (const [k, val] of Object.entries(fields ?? {})) {
              if (!EDITABLE.has(k)) continue;
              if (val === null || val === false || (k === "scale" && val === 1)) delete current[k];
              else current[k] = val;
            }
            fs.writeFileSync(mdFile, writeVariant(md, v, current));
            return send(res, 200, { ok: true, wordmark: current });
          }

          if (req.method === "POST" && url.pathname === "/api/replace") {
            const slug = url.searchParams.get("slug");
            const dir = projectDir(slug);
            if (!dir) return send(res, 404, { error: "找不到作品" });
            const body = await readBody(req);
            if (body.toString("ascii", 0, 4) !== "RIFF" || body.toString("ascii", 8, 12) !== "WEBP") {
              return send(res, 400, { error: "需要 webp 圖檔" });
            }
            const v = variantOf(url.searchParams.get("v"));
            const mdFile = path.join(dir, "index.md");
            const md = fs.readFileSync(mdFile, "utf8");
            const extras = readExtras(md);
            if (v > extras.length + 1) return send(res, 400, { error: "款號不對" });
            // v 等於現有款數：新增一款
            const current = (v === 0 ? readWordmark(md) : extras[v - 1]) ?? {};
            const name = v === 0 ? "wordmark.webp" : current.src ? path.basename(current.src) : newExtraName(dir, md);
            fs.writeFileSync(path.join(dir, name), body);
            current.src = `/projects/${slug}/${name}`;
            // 原圖直接用（不經過去背處理）另外標記，方便之後辨認
            current.source = url.searchParams.get("mode") === "direct" ? "direct" : "cutout";
            const ink = parseFloat(url.searchParams.get("ink") ?? "");
            if (Number.isFinite(ink)) current.ink = Math.round(ink * 1000) / 1000;
            delete current.hidden;
            delete current.redo;
            delete current.needsImage;
            delete current.reviewed;
            fs.writeFileSync(mdFile, writeVariant(md, v, current));
            return send(res, 200, { ok: true, v, wordmark: current });
          }
          if (req.method === "POST" && url.pathname === "/api/source") {
            const slug = url.searchParams.get("slug");
            const dir = projectDir(slug);
            if (!dir) return send(res, 404, { error: "找不到作品" });
            const body = await readBody(req);
            if (body.toString("ascii", 0, 4) !== "RIFF" || body.toString("ascii", 8, 12) !== "WEBP") {
              return send(res, 400, { error: "需要 webp 圖檔" });
            }
            const v = variantOf(url.searchParams.get("v"));
            const mdFile = path.join(dir, "index.md");
            const md = fs.readFileSync(mdFile, "utf8");
            const current = readVariant(md, v);
            if (!current) return send(res, 400, { error: "這件作品還沒有字圖" });
            // 原始圖跟著字圖檔名：wordmark.webp → wordmark-source.webp、wordmark-2.webp → wordmark-source-2.webp
            const name = sourceNameOf(path.basename(current.src));
            fs.writeFileSync(path.join(dir, name), body);
            current.sourceImage = `/projects/${slug}/${name}`;
            fs.writeFileSync(mdFile, writeVariant(md, v, current));
            return send(res, 200, { ok: true, wordmark: current });
          }
          if (req.method === "POST" && url.pathname === "/api/remove") {
            const { slug, v: rawV } = JSON.parse((await readBody(req)).toString("utf8"));
            const v = variantOf(rawV);
            const dir = projectDir(slug);
            if (!dir) return send(res, 404, { error: "找不到作品" });
            if (v === 0) return send(res, 400, { error: "主字圖不能刪除，只能隱藏" });
            const mdFile = path.join(dir, "index.md");
            const md = fs.readFileSync(mdFile, "utf8");
            const list = readExtras(md);
            const [gone] = list.splice(v - 1, 1);
            if (!gone) return send(res, 404, { error: "找不到這一款" });
            fs.writeFileSync(mdFile, writeExtras(md, list));
            for (const f of [gone.src, gone.sourceImage]) {
              const file = f && path.join(dir, path.basename(f));
              if (file && fs.existsSync(file)) fs.rmSync(file);
            }
            return send(res, 200, { ok: true });
          }
          send(res, 404, { error: "not found" });
        } catch (err) {
          send(res, 500, { error: String(err) });
        }
      });
    },
  };
}
