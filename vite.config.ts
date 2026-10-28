import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Id de cada build: vai pro bundle (__BUILD_ID__) e pro /version.json. O app
// compara os dois e recarrega sozinho quando sai versao nova (o navegador
// guardava a versao velha e F5 nem sempre pegava a nova).
const BUILD_ID = new Date().toISOString()

function versionJson(): Plugin {
  return {
    name: 'version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
    },
  }
}

export default defineConfig({
  plugins: [react(), versionJson()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
