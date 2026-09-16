import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwind from '@tailwindcss/vite'

/**
 * Which daemon the dev server proxies to.
 *
 * Read from the environment so the browser suite can run on a port of its own
 * while a real Factory — Pro's desktop app, say — keeps 7317. Before this the
 * port was a literal in three places, and the suite's own daemon could not bind
 * it: the run then proceeded against *whatever* answered, which on one occasion
 * was the developer's real installation. Failing would have been better; not
 * colliding is better still.
 */
const daemonPort = Number(process.env.FACTORY_PORT ?? 7317)
const webPort = Number(process.env.FACTORY_WEB_PORT ?? 5317)

export default defineConfig({
  plugins: [vue(), tailwind()],
  server: {
    port: webPort,
    proxy: {
      // 127.0.0.1, not localhost: on current macOS `localhost` resolves to ::1
      // first, and a server bound to IPv4 loopback never answers. Costs an
      // afternoon the first time.
      '/api': { target: `http://127.0.0.1:${daemonPort}`, changeOrigin: false },
    },
  },
})
