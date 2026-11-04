import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  server: {
    // Dev only: forward API calls to the Bun server on :3000.
    proxy: { "/api": "http://localhost:3000" }
  },
  build: { outDir: "dist", sourcemap: true }
})
