import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * robots.txt and sitemap.xml are generated from VITE_SITE_URL rather than
 * committed, so the deployment domain lives in exactly one place. index.html
 * picks up the same value through Vite's %VITE_*% substitution.
 */
function seoFiles(siteUrl: string): Plugin {
  const base = siteUrl.replace(/\/+$/, '')
  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`
  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url>\n    <loc>${base}/</loc>\n    <changefreq>monthly</changefreq>\n` +
    '    <priority>1.0</priority>\n  </url>\n</urlset>\n'

  return {
    name: 'seo-files',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots })
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap })
    },
  }
}

/**
 * Dev-only. Lets a page write a generated asset (the OG image) into public/,
 * because the only renderer for these compositions is the browser itself.
 * Filenames are allow-listed and the middleware never ships: `apply: 'serve'`
 * keeps it out of the production build entirely.
 */
const WRITABLE = new Set(['og.jpg', 'og.png', 'apple-touch-icon.png'])

function assetWriter(): Plugin {
  return {
    name: 'dev-asset-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__write-asset', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          void (async () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                name?: string
                base64?: string
              }
              if (!body.name || !WRITABLE.has(body.name) || !body.base64) {
                res.statusCode = 400
                res.end('not writable')
                return
              }
              const target = resolve(process.cwd(), 'public', body.name)
              await writeFile(target, Buffer.from(body.base64, 'base64'))
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify({ ok: true, path: target }))
            } catch (e) {
              res.statusCode = 500
              res.end(String(e))
            }
          })()
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), seoFiles(env['VITE_SITE_URL'] ?? ''), assetWriter()],
    build: { target: 'es2022', assetsInlineLimit: 0 },
  }
})
