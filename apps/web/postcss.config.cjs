const path = require('node:path')

// @mekari/pixel3-postcss looks for ./node_modules/@mekari/pixel3 relative to the cwd to scan the
// component dist files for recipes. In a workspace the packages are hoisted to the repo root,
// so we point at them explicitly.
const mekariDir = path.resolve(path.dirname(require.resolve('@mekari/pixel3')), '../..')

module.exports = {
  plugins: {
    '@mekari/pixel3-postcss': {
      include: ['./src/**/*.{js,jsx,ts,tsx,vue}', `${mekariDir}/**/dist/**/*.{js,mjs}`],
    },
  },
}
