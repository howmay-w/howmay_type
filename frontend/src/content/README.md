# 新增／修改作品

## 步驟

### 新增作品

1. 在 `src/content/projects/` 底下新增一個資料夾（名稱 = 網址 slug）
2. 放入 `index.md`（格式見下方）以及對應的圖片、影片
3. 執行圖片優化（必做）：
   ```bash
   pnpm optimize-images
   ```
4. dev server 會自動 reload，`http://localhost:4321` 預覽即可

### 修改／刪除作品

- **改內容**：直接編輯 `index.md`，dev server 會自動重新載入
- **換圖片**：同檔名覆蓋後，**再執行一次 `pnpm optimize-images`**（腳本會自動偵測原圖比 webp 新，重新產生）
- **刪作品**：整個資料夾刪掉即可

---

## index.md 格式

```yaml
---
title: "作品標題" # 必填
description: "一句話描述" # 選填
pubDate: 2025-01-01 # 選填，用於排序
tags: ["標籤A", "標籤B"] # 選填

# 首頁縮圖（沒填就用 images[0]）
image:
  src: "/projects/slug/media_0.jpg"
  alt: "說明"

# 作品頁輪播圖（有多張圖時填）
images:
  - src: "/projects/slug/media_0.jpg"
    alt: "圖 1"
  - src: "/projects/slug/media_1.jpg"
    alt: "圖 2"

# 影片（單部）；poster 為選填，建議放首幀截圖可避免輪播切到時白閃
video:
  src: "/projects/slug/video_0.mp4"
  poster: "/projects/slug/video_0_poster.jpg"

# 影片（多部）
videos:
  - src: "/projects/slug/video_0.mp4"
    poster: "/projects/slug/video_0_poster.jpg"

# 滑鼠 hover 時在縮圖播放的影片
hoverVideo:
  src: "/projects/slug/video_0.mp4"

# hover 影片的顯示模式（選填）
# - 不填／cover：裁切填滿格子（預設，適合 1:1 正方形影片）
# - contain：完整顯示 + 白底（適合非 1:1，如 4:5、9:16 直式）
hoverVideoFit: contain

# Instagram Reels 嵌入（選填）：用官方嵌入保留 IG 版權，會顯示在內文下方
instagramReels:
  - "https://www.instagram.com/reel/xxxxx/"
  - "https://www.instagram.com/p/yyyyy/"
---
這裡用 Markdown 寫內文。
```

路徑格式：`/projects/<資料夾名稱>/檔名`

---

## 注意事項

- 圖片副檔名請用**小寫**（`media_0.jpg` 而非 `media_0.JPG`）
- 每次新增或替換圖片後，都要執行 `pnpm optimize-images`；腳本會自動跳過沒動過的圖、重新產生被換掉的圖；漏跑的話首頁縮圖會 fallback 到原始 jpg（仍能顯示，但比較慢）
- `thumbnail` 欄位可指定一張作為首頁縮圖，不用 `images[0]`
- `hoverVideoFit`：**影片不是 1:1 正方形，就加 `hoverVideoFit: contain`**；1:1 不用填，預設會裁切填滿
