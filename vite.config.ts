import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "./",
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: "es2020",
    sourcemap: true,
  },
});
