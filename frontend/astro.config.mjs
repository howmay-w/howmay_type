// @ts-check
import { defineConfig, envField } from "astro/config";
import { loadEnv } from "vite";

import sitemap from "@astrojs/sitemap";
import {
  projectAssetsPlugin,
  projectAssetsDevPlugin,
} from "./src/plugins/project-assets.mjs";
import { wordmarkAdminPlugin } from "./src/plugins/wordmark-admin.mjs";

const { SITE_URL } = loadEnv(process.env.NODE_ENV, process.cwd(), "");

// https://astro.build/config
export default defineConfig({
  devToolbar: {
    enabled: false,
  },
  prefetch: true,
  trailingSlash: "never",
  site: SITE_URL,
  integrations: [
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname.replace(/\/$/, "") || "/";
        return !["/history", "/releases", "/success"].includes(path);
      },
    }),
  ],
  image: {
    remotePatterns: [{ protocol: "https" }],
  },
  vite: {
    // @ts-expect-error - custom plugins for project asset copy/serve
    plugins: [projectAssetsPlugin(), projectAssetsDevPlugin(), wordmarkAdminPlugin()],
    server: {
      // 0.0.0.0 讓同一 Wi‑Fi 下的手機可連 http://<你電腦的 IP>:4321 測試
      host: "0.0.0.0",
      port: 4321,
    },
    css: {
      devSourcemap: true,
    },
  },
  env: {
    schema: {
      SITE_URL: envField.string({
        context: "client",
        access: "public",
      }),
    },
  },
});
