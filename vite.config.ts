import { defineConfig } from "vite";

import { SERVER_PORT } from "./shared/constants";

export default defineConfig({
  root: "client",
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/colyseus": {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        ws: true,
        rewrite: (path) => path.replace(/^\/colyseus/u, ""),
      },
    },
  },
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022" },
});
