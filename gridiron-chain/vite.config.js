import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/datasciencecoursera/" : "/",
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      process: "process/browser",
    },
  },
  optimizeDeps: {
    include: ["ethers"],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        play: resolve(__dirname, "play.html"),
        careerLab: resolve(__dirname, "career-lab.html"),
      },
    },
  },
}));
