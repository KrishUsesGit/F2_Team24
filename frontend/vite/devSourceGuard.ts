import type { Plugin } from 'vite'

/**
 * Dev-server request guard. Vite serves the project directory, which would
 * include the frontend's own non-source files (manifest, lockfile, configs,
 * the data plugin, scripts). Those are not part of the application and are
 * refused over HTTP. This acts on HTTP requests only; it does not affect how
 * tools (e.g. Vitest) read the same files.
 *
 * Research data and unrelated repository files are protected separately by
 * `server.fs.allow` (frontend/ only) and by the explicit /data allowlist.
 */
const BLOCKED_NAME =
  /(?:^|\/)(?:package(?:-lock)?\.json|README\.md|tsconfig[^/]*\.json|eslint\.config\.js|vite\.config\.[cm]?[jt]s)$/i
const BLOCKED_DIR = /(?:^|\/)(?:vite|scripts|dist)\//i

export function isBlockedDevPath(rawPath: string): boolean {
  let path: string
  try {
    path = decodeURIComponent(rawPath)
  } catch {
    return true
  }
  path = path.replace(/\\/g, '/')
  // Third-party packages are served from node_modules for the app's imports.
  if (path.includes('/node_modules/')) return false
  return BLOCKED_NAME.test(path) || BLOCKED_DIR.test(path)
}

export function devSourceGuard(): Plugin {
  return {
    name: 'hoptrace-dev-source-guard',
    apply: 'serve',
    configureServer(server) {
      // Registered directly (not returned), so it runs before Vite's own middleware.
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '/').split('?')[0] ?? '/'
        if (isBlockedDevPath(pathname)) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end('Not found')
          return
        }
        next()
      })
    },
  }
}
