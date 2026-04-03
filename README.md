# 皓梅 Howmay 的畫字作品

個人字型／設計作品展示網站。

正式連結：[https://howmaywang.com](https://howmaywang.com)

---

## 簡介

本專案為上述網站的程式與內容來源。展示字型與設計相關作品，內容以 Markdown 管理於 `frontend/src/content/projects/`，可透過 **Discord Bot**（`/新作品`、`/修改作品`）投稿，或手動新增／編輯專案資料夾與 `index.md`。前端使用 Astro 建置，部署後由網站主機與 Bot（如 Fly.io）各自運作。

---

## 專案結構

- **frontend/** — Astro 網站與作品內容（Markdown、媒體檔）
- **discord-bot/** — Discord 機器人，用於從頻道建立／覆寫／僅更新作品內文，並可自動 push 至本 repo

---

## 常用指令

以下指令皆在**專案根目錄**執行：

| 指令                   | 說明                                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| `pnpm install`         | 安裝依賴                                                                          |
| `pnpm run dev`         | 啟動本地開發伺服器（前端）                                                        |
| `pnpm run build`       | 建置前端靜態站                                                                    |
| `pnpm run preview`     | 本地預覽建置結果                                                                  |
| `pnpm optimize-images` | 壓縮 `frontend/src/content/projects/` 內圖片為 WebP（新增／更新作品圖片後可執行） |

Discord Bot 安裝、環境變數與使用方式見 **[discord-bot/README.md](discord-bot/README.md)**。

### 圖片壓縮（GitHub Actions）

若 Bot 部署在 Fly 等環境並設定 **`SKIP_OPTIMIZE_IMAGES=true`**，投稿後會先 push 原始圖，再由 **[.github/workflows/optimize-images.yml](.github/workflows/optimize-images.yml)** 在 `main` 上自動執行 `pnpm optimize-images` 並提交 WebP（無須開本機）。

---

## 致謝 / Credits

- UI 設計基於 [Alex Tkachev](https://alextkachev.com/) 的 [Players Club](https://dribbble.com/shots/25156320-Players-Club-UI-Animation)
- 版型來源：[Codrops](https://www.codrops.com) 的 [Players Club 文章](https://tympanus.net/codrops/?p=86632)
- 建置：[Astro](https://astro.build/)

---

## License

[MIT](LICENSE)
