import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const corePath = new URL("../color-mix-lab/src/workflows/vertex/core", import.meta.url).pathname;
const repoRoot = new URL("..", import.meta.url).pathname;

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@core": corePath,
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});
