// @ts-check
import { defineConfig, envField } from "astro/config";
import { loadEnv } from "vite";

import sitemap from "@astrojs/sitemap";
import {
  projectAssetsPlugin,
  projectAssetsDevPlugin,
} from "./src/plugins/project-assets.mjs";

const { SITE_URL } = loadEnv(process.env.NODE_ENV, process.cwd(), "");

// https://astro.build/config
export default defineConfig({
  devToolbar: {
    enabled: false,
  },
  prefetch: true,
  trailingSlash: "never",
  site: SITE_URL,
  integrations: [sitemap()],
  image: {
    remotePatterns: [{ protocol: "https" }],
  },
  vite: {
    // @ts-expect-error - custom plugins for project asset copy/serve
    plugins: [projectAssetsPlugin(), projectAssetsDevPlugin()],
    server: {
      // 強制 IPv4，避免 EPERM on ::1（部分環境會阻擋 IPv6 綁定）
      host: "127.0.0.1",
      port: 4321,
      // 若需從其他裝置連線，可改為 host: true 或 host: "0.0.0.0"
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
