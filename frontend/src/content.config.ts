import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// 作品集：每個專案一個資料夾，內含 index.md 與該篇使用的圖片/影片
const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    thumbnail: z
      .object({
        src: z.string(),
        alt: z.string().optional(),
      })
      .optional(),
    image: z
      .object({
        src: z.string(),
        alt: z.string().optional(),
      })
      .optional(),
    video: z
      .object({
        src: z.string(),
        type: z.string().optional(),
        poster: z.string().optional(),
      })
      .optional(),
    videos: z
      .array(
        z.object({
          src: z.string(),
          type: z.string().optional(),
          poster: z.string().optional(),
        })
      )
      .optional(),
    hoverVideo: z
      .object({
        src: z.string(),
        type: z.string().optional().default("video/mp4"),
      })
      .optional(),
    hoverVideoFit: z.enum(["cover", "contain"]).optional(),
    images: z
      .array(
        z.object({
          src: z.string(),
          alt: z.string().optional(),
        })
      )
      .optional(),
    // 單色字牆用：白字透明背景的字圖（cutout = 手作去背、auto = 從貼文圖自動提取）
    wordmark: z
      .object({
        src: z.string(),
        source: z.enum(["cutout", "auto", "ai"]).optional(),
        accent: z.string().optional(),
        // 字圖不透明像素比例，用來平衡粗細字的量感
        ink: z.number().optional(),
        // 圖上的字數；沒填就從標題推算
        chars: z.number().optional(),
        size: z.enum(["s", "m", "l"]).optional(),
        hidden: z.boolean().optional(),
      })
      .optional(),
    pubDate: z.coerce.date().optional(),
    tags: z.array(z.string()).optional(),
  }),
});

export const collections = { projects };
