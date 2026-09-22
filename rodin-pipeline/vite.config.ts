import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { userDataPlugin } from "./vite.user-data.mjs";

const corePath = new URL("../color-mix-lab/src/workflows/vertex/core", import.meta.url).pathname;
const repoRoot = new URL("..", import.meta.url).pathname;

export default defineConfig({
  base: "./",
  plugins: [react(), userDataPlugin()],
  resolve: {
    alias: {
      "@core": corePath,
    },
  },
  server: {
    // A fixed port keeps the browser origin (and everything stored in it) stable.
    port: 5173,
    strictPort: true,
    fs: {
      allow: [repoRoot],
    },
  },
});
