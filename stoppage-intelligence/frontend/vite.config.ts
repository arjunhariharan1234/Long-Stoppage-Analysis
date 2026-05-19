import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/v10/stoppage-intelligence/",
  plugins: [react(), tailwindcss()],
  optimizeDeps: { include: ["ft-design-system"] },
  build: {
    outDir: "dist/v10/stoppage-intelligence",
    emptyOutDir: true,
    cssMinify: "esbuild",
  },
});
