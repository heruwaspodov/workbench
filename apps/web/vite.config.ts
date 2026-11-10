import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const api = process.env.API_URL ?? 'http://localhost:3000'

// The dev server follows APP_URL so OAuth redirect URIs can use a non-localhost host (e.g. http://one-desk.local).
const app = new URL(process.env.APP_URL ?? 'http://localhost:5173')
const port = Number(app.port || (app.protocol === 'https:' ? 443 : 80))
const isLocalhost = ['localhost', '127.0.0.1'].includes(app.hostname)

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  build: {
    rolldownOptions: {
      // @mekari/pixel3 re-exports ~50 packages (rich text editor, charts, …) without declaring
      // "sideEffects": false. Marking its JS as side-effect free lets unused components be dropped.
      treeshake: {
        moduleSideEffects: (id: string) => !(/[\\/]@mekari[\\/]pixel3[^\\/]*[\\/].*\.m?js$/.test(id)),
      },
    },
  },
  server: {
    port,
    strictPort: true,
    // Without root, macOS only allows ports < 1024 on the wildcard address.
    host: port < 1024 ? true : 'localhost',
    allowedHosts: isLocalhost ? undefined : [app.hostname],
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/auth': { target: api, changeOrigin: false },
    },
  },
})
