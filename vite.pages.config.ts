import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { defineConfig } from "vite";

export default defineConfig({
  root: "pages-src",
  base: "./",
  publicDir: "../public",
  plugins: [react(), nodePolyfills()],
  build: {
    outDir: "../dist-pages",
    emptyOutDir: true,
  },
});
