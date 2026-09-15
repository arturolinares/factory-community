import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwind from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwind()],
  server: {
    port: 5317,
    proxy: {
      // 127.0.0.1, not localhost: on current macOS `localhost` resolves to ::1
      // first, and a server bound to IPv4 loopback never answers. Costs an
      // afternoon the first time.
      '/api': { target: 'http://127.0.0.1:7317', changeOrigin: false },
    },
  },
})
