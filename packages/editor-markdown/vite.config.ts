import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: [
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
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [
        "@codemirror/autocomplete",
        "@codemirror/commands",
        "@codemirror/lang-markdown",
        "@codemirror/language",
        "@codemirror/search",
        "@codemirror/state",
        "@codemirror/view",
        "@interfacez/ui",
      ],
    },
  },
});
