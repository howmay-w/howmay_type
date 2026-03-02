/**
 * 讓每個專案資料夾內的媒體（圖片、影片）可被存取：
 * - build：複製 src/content/projects/<slug>/* 的非 .md 檔案到 dist/projects/<slug>/
 * - dev：對 /projects/<slug>/* 的請求從 src/content/projects/<slug>/ 提供靜態檔
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentProjects = path.resolve(__dirname, "../content/projects");
const ASSET_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".mp4",
  ".webm",
  ".mov",
  ".ogg",
]);

function isAsset(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ASSET_EXT.has(ext);
}

function copyProjectAssets(outDir) {
  if (!fs.existsSync(contentProjects)) return;
  const slugs = fs
    .readdirSync(contentProjects, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const destBase = path.join(outDir, "projects");
  for (const slug of slugs) {
    const srcDir = path.join(contentProjects, slug);
    const destDir = path.join(destBase, slug);
    if (!fs.existsSync(srcDir)) continue;
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name !== "index.md" && isAsset(e.name)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(path.join(srcDir, e.name), path.join(destDir, e.name));
      }
    }
  }
}

export function projectAssetsPlugin() {
  return {
    name: "project-assets",
    apply: "build",
    closeBundle() {
      const outDir = path.resolve(process.cwd(), "dist");
      if (fs.existsSync(outDir)) copyProjectAssets(outDir);
    },
  };
}

export function projectAssetsDevPlugin() {
  return {
    name: "project-assets-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = req.url
          ?.split("?")[0]
          ?.match(/^\/projects\/([^/]+)\/([^/]+)$/);
        if (!match) return next();
        let slug, filename;
        try {
          slug = decodeURIComponent(match[1]);
          filename = decodeURIComponent(match[2]);
        } catch {
          return next();
        }
        if (!slug || !filename || filename.toLowerCase().endsWith(".md"))
          return next();
        const filePath = path.join(contentProjects, slug, filename);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile())
          return next();

        const mimeType = getMime(filename);
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const rangeHeader = req.headers["range"];

        res.setHeader("Content-Type", mimeType);
        res.setHeader("Accept-Ranges", "bytes");

        if (rangeHeader) {
          // 解析 Range: bytes=start-end
          const [, rangeStr] = rangeHeader.split("=");
          const [startStr, endStr] = rangeStr.split("-");
          const start = parseInt(startStr, 10);
          const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
          const chunkSize = end - start + 1;

          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Content-Length": chunkSize,
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.setHeader("Content-Length", fileSize);
          res.writeHead(200);
          fs.createReadStream(filePath).pipe(res);
        }
      });
    },
  };
}

function getMime(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".avif": "image/avif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".ogg": "video/ogg",
  };
  return map[ext] ?? "application/octet-stream";
}
