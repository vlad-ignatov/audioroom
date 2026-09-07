import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

/**
 * Inject a Content-Security-Policy into the built HTML only.
 *
 * Applying it in dev too would break HMR, which needs inline scripts and eval.
 * Streams, station artwork and the directory API are all remote by nature, so
 * media/img/connect stay open while scripts are locked to the bundle.
 */
function cspPlugin() {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' data: blob: https: http:",
    "connect-src 'self' https: http:",
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-src 'none'",
  ].join('; ')

  return {
    name: 'inject-csp',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`,
      )
    },
  }
}

export default defineConfig({
  // Relative asset paths: the packaged app loads index.html over file://.
  base: './',
  plugins: [react(), tailwindcss(), cspPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
})
