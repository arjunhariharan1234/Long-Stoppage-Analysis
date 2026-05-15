import { defineConfig } from "vite";

export default defineConfig({
  base: "/v10/stoppage-intelligence/",
  build: {
    outDir: "dist/v10/stoppage-intelligence",
    emptyOutDir: true,
  },
});
