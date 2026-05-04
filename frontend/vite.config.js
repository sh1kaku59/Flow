import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir: "../backend-node",
  envPrefix: ["VITE_", "SUPABASE_"],
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "localhost",
    port: 5173,
    strictPort: true,
  },
})
