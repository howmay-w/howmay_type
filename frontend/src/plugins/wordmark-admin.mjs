/**
 * 字圖管理頁（只在 dev server 提供，build 不會包含）：
 * - GET  /__wordmarks             管理頁
 * - GET  /__wordmarks/editor      精修視窗（wordmark-editor/，以 iframe 疊在管理頁上）
 * - GET  /__wordmarks/api/list    所有作品的字圖資料
 * - POST /__wordmarks/api/update  修改 wordmark 欄位（reviewed / hidden / scale / chars）
 * - POST /__wordmarks/api/replace?slug=&ink=  上傳處理好的 webp，取代 wordmark.webp
 * 寫回的是 src/content/projects/<slug>/index.md 的 wordmark 區塊與同資料夾的 wordmark.webp。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentProjects = path.resolve(__dirname, "../content/projects");
const pageFile = path.join(__dirname, "wordmark-admin.html");
// 精修視窗（以 iframe 疊在管理頁上），程式在 wordmark-editor/，由 Vite 轉譯
const editorFile = path.join(__dirname, "wordmark-editor", "editor.html");
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
function writeWordmark(md, fields) {
  const order = ["src", "source", "accent", "ink", "chars", "size", "scale", "hidden", "redo", "needsImage", "reviewed"];
  const keys = [...order.filter((k) => k in fields), ...Object.keys(fields).filter((k) => !order.includes(k))];
  const block = `wordmark:\n${keys.map((k) => `  ${k}: ${JSON.stringify(fields[k])}\n`).join("")}`;
  if (BLOCK_RE.test(md)) return md.replace(BLOCK_RE, block);
  const end = md.indexOf("\n---", 4);
  return `${md.slice(0, end + 1)}${block}${md.slice(end + 1)}`;
}
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

function listProjects() {
  return fs
    .readdirSync(contentProjects, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(contentProjects, d.name, "index.md")))
    .map((d) => {
      const slug = d.name;
      const md = fs.readFileSync(path.join(contentProjects, slug, "index.md"), "utf8");
      const wordmark = readWordmark(md);
      const file = path.join(contentProjects, slug, "wordmark.webp");
      const exists = fs.existsSync(file);
      return {
        slug,
        title: frontValue(md, "title") ?? slug,
        date: frontValue(md, "pubDate") ?? "",
        // 原圖：作品資料登記的第一張圖；只有影片的作品（例如「讀字」）改用資料夾裡的 media_*.webp
        post: firstImage(md) ?? fallbackImage(slug),
        wordmark,
        size: exists ? webpSize(file) : null,
        mtime: exists ? fs.statSync(file).mtimeMs : 0,
        // 最近編輯：index.md 或字圖最後修改的時間（管理頁「最近編輯」排序用）
        edited: Math.max(fs.statSync(path.join(contentProjects, slug, "index.md")).mtimeMs, exists ? fs.statSync(file).mtimeMs : 0),
      };
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
          if (req.method === "GET" && url.pathname === "/editor") {
            return send(res, 200, fs.readFileSync(editorFile, "utf8"), "text/html; charset=utf-8");
          }
          if (req.method === "GET" && url.pathname === "/api/list") return send(res, 200, listProjects());

          if (req.method === "POST" && url.pathname === "/api/update") {
            const { slug, fields } = JSON.parse((await readBody(req)).toString("utf8"));
            const dir = projectDir(slug);
            if (!dir) return send(res, 404, { error: "找不到作品" });
            const mdFile = path.join(dir, "index.md");
            const md = fs.readFileSync(mdFile, "utf8");
            const current = readWordmark(md);
            if (!current) return send(res, 400, { error: "這件作品還沒有字圖" });
            for (const [k, v] of Object.entries(fields ?? {})) {
              if (!EDITABLE.has(k)) continue;
              if (v === null || v === false || (k === "scale" && v === 1)) delete current[k];
              else current[k] = v;
            }
            fs.writeFileSync(mdFile, writeWordmark(md, current));
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
            fs.writeFileSync(path.join(dir, "wordmark.webp"), body);
            const mdFile = path.join(dir, "index.md");
            const md = fs.readFileSync(mdFile, "utf8");
            const current = readWordmark(md) ?? {};
            current.src = `/projects/${slug}/wordmark.webp`;
            current.source = "cutout";
            const ink = parseFloat(url.searchParams.get("ink") ?? "");
            if (Number.isFinite(ink)) current.ink = Math.round(ink * 1000) / 1000;
            delete current.hidden;
            delete current.redo;
            delete current.needsImage;
            delete current.reviewed;
            fs.writeFileSync(mdFile, writeWordmark(md, current));
            return send(res, 200, { ok: true, wordmark: current });
          }
          send(res, 404, { error: "not found" });
        } catch (err) {
          send(res, 500, { error: String(err) });
        }
      });
    },
  };
}
