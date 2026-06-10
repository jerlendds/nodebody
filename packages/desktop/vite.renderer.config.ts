import { resolve } from "node:path";
import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@interfacez\/editor-markdown$/,
        replacement: resolve(__dirname, "../editor-markdown/src/index.ts"),
      },
      {
        find: /^@interfacez\/editor-markdown\/markdown-editor\.css$/,
        replacement: resolve(
          __dirname,
          "../editor-markdown/src/markdown-editor.css",
        ),
      },
      {
        find: /^@interfacez\/editor-markdown\/(.*)$/,
        replacement: resolve(__dirname, "../editor-markdown/src/$1"),
      },
      {
        find: /^@interfacez\/ui$/,
        replacement: resolve(__dirname, "../ui/src/index.ts"),
      },
      {
        find: /^@interfacez\/ui\/index\.css$/,
        replacement: resolve(__dirname, "../ui/src/index.css"),
      },
      {
        find: /^@interfacez\/ui\/(.*)$/,
        replacement: resolve(__dirname, "../ui/src/$1"),
      },
    ],
  },
});
