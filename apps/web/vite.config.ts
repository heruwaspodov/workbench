import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const api = process.env.API_URL ?? 'http://localhost:3000'

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
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/auth': { target: api, changeOrigin: false },
    },
  },
})
