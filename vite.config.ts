import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 编辑器、Markdown 渲染与 UI 组件按能力拆包，移动端首次进入目录页无需下载全部编辑依赖。
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@uiw/react-codemirror")) return "editor-react";
          if (id.includes("@codemirror/view") || id.includes("@codemirror/state")) return "editor-core";
          if (id.includes("@codemirror/") || id.includes("@lezer/")) return "editor-features";
          if (id.includes("react-markdown") || id.includes("remark-") || id.includes("micromark") || id.includes("mdast-") || id.includes("hast-")) return "markdown-vendor";
          if (id.includes("radix-ui") || id.includes("lucide-react")) return "ui-vendor";
          if (id.includes("react") || id.includes("scheduler")) return "react-vendor";
          return undefined;
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      // 本地预览沿用与生产部署一致的路径；生产环境必须由网关实现同源反向代理。
      "/api/webdav": {
        target: "https://dav.jianguoyun.com",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api\/webdav/, "/dav"),
      },
    },
  },
}));
