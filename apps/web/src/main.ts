import { PixelPlugin, type PixelPluginConfig, usePixelTheme } from '@mekari/pixel3'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './pixel.css'

// Semantic tokens (border.default, background.surface, text.secondary, ...) exist only under the "next" theme.
usePixelTheme().setNextTheme(true)

createApp(App)
  .use(PixelPlugin, { pixelTheme: true, toastManager: true, tooltipDirective: true } satisfies PixelPluginConfig)
  .use(createPinia())
  .use(router)
  .mount('#app')
