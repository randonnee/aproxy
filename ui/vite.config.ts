import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/events": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/host": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/scenarios": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/rules": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/views": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/proxy": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/simulators": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/ca": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
