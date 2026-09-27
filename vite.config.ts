/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Brand files shared by the app and frontend/site (logos, photos, menus), served from the site root.
  publicDir: "frontend/public",
  test: {
    // Every test lives under tests/: tests/convex (convex-test), tests/pos and tests/office (UI, jsdom), tests/scripts.
    include: ["tests/**/*.test.{ts,tsx,mjs}"],
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": new URL("./frontend/app", import.meta.url).pathname,
      "@convex": new URL("./convex", import.meta.url).pathname,
    },
  },
})
