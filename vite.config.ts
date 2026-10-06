import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/* index.html carries a strict CSP for the packaged app. The dev server needs
   the React refresh preamble, an inline script, so drop the CSP when serving. */
const devCsp = (): Plugin => ({
  name: 'omamole-dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
})

export default defineConfig({
  // Relative asset paths are required: Electron loads the built index.html over
  // file://, where absolute "/assets/..." URLs resolve to the filesystem root.
  base: './',
  plugins: [react(), devCsp()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
