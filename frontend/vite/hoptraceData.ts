import type { Plugin } from 'vite'
import { allowedAssets, resolveDataRequest } from './dataAllowlist.ts'

/**
 * Serves the allowlisted presentation data in dev (`/data/...`) and emits
 * exactly the same files into the production build. There is no API server:
 * the data are static JSON copied from the repository's existing artifacts.
 */
export function hoptraceData(options: { repoRoot: string }): Plugin {
  const { repoRoot } = options
  return {
    name: 'hoptrace-data',

    configureServer(server) {
      server.middlewares.use('/data', (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405
          res.setHeader('Allow', 'GET, HEAD')
          res.end()
          return
        }
        // Connect strips the mount prefix: req.url is e.g. "/bundles/x.json".
        const relative = (req.url ?? '/').split('?')[0] ?? '/'
        const result = resolveDataRequest(repoRoot, relative)
        res.statusCode = result.status
        res.setHeader('Content-Type', result.contentType)
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Cache-Control', 'no-store')
        res.end(req.method === 'HEAD' ? undefined : result.body)
      })
    },

    generateBundle() {
      for (const asset of allowedAssets(repoRoot)) {
        this.emitFile({ type: 'asset', fileName: asset.fileName, source: asset.source })
      }
    },
  }
}
