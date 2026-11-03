import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Harper resolves its WASM binary relative to its ESM module. Pre-bundling that
  // module moves it away from the binary in development, so keep these entry points native.
  optimizeDeps: { exclude: ["harper.js", "harper.js/binary"] },
  clearScreen: false,
  server: {
    strictPort: true,
    port: 1420,
  },
  build: {
    target: ["es2021", "chrome120", "safari13"],
    minify: "esbuild",
  },
});
