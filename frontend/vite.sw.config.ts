import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, "src/sw.ts"),
      output: {
        entryFileNames: "sw.js",
      },
    },
  },
});
