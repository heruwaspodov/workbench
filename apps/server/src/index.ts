import { existsSync, statSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'
import { app } from './app'
import { env } from './config/env'

export type { App } from './app'

// In production the Vue build is served by the same process (single monolith container).
const webDist = resolve(import.meta.dir, '../../web/dist')
if (existsSync(webDist)) {
  const indexHtml = join(webDist, 'index.html')
  app.get('/*', ({ path, set }) => {
    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      set.status = 404
      return { code: 'NOT_FOUND', message: 'Not found' }
    }
    // Resolve inside dist only (no path traversal); fall back to index.html for client routes.
    const candidate = resolve(webDist, `.${normalize(decodeURIComponent(path))}`)
    const isFile = candidate.startsWith(webDist) && existsSync(candidate) && statSync(candidate).isFile()
    if (isFile && candidate.includes('/assets/')) set.headers['cache-control'] = 'public, max-age=31536000, immutable'
    return Bun.file(isFile ? candidate : indexHtml)
  })
}

if (import.meta.main) {
  app.listen(env.port)
  console.log(`🗂  One Desk running on http://localhost:${env.port}`)
}
