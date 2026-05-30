import { resolve } from "node:path";
import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@nodebody\/ui$/,
        replacement: resolve(__dirname, "../ui/src/index.ts"),
      },
      {
        find: /^@nodebody\/ui\/index\.css$/,
        replacement: resolve(__dirname, "../ui/src/index.css"),
      },
      {
        find: /^@nodebody\/ui\/(.*)$/,
        replacement: resolve(__dirname, "../ui/src/$1"),
      },
    ],
  },
});
