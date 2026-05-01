// Vite — app Superadmin (código em ./src; UI partilhada via alias @niochat → painel-provedor)
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const painelSrc = path.resolve(__dirname, '../painel-provedor/src')

/** `@/` em ficheiros sob painel-provedor/src resolve para o painel; nos restantes, para superadmin/src */
function painelScopedAtAlias() {
  return {
    name: 'painel-scoped-at-alias',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!id.startsWith('@/')) return null
      const suffix = id.slice(2)
      if (!importer) return path.resolve(__dirname, 'src', suffix)
      // Caminhos relativos (ex.: ../painel-provedor/...) resolvem contra cwd (pasta do superadmin)
      const absImporter = path.resolve(importer).replace(/\\/g, '/')
      if (absImporter.includes('/painel-provedor/src/')) {
        return path.resolve(painelSrc, suffix)
      }
      return path.resolve(__dirname, 'src', suffix)
    },
  }
}

export default defineConfig(({ mode }) => {
  const backendDir = path.resolve(__dirname, '../backend')
  const allEnv = loadEnv(mode, backendDir, '')
  const viteEnv = loadEnv(mode, backendDir, 'VITE_')

  const injectEnvPlugin = () => ({
    name: 'inject-backend-env',
    config(config) {
      if (!viteEnv.VITE_SUPABASE_URL && allEnv.SUPABASE_URL) {
        config.define = config.define || {}
        config.define['import.meta.env.VITE_SUPABASE_URL'] = JSON.stringify(allEnv.SUPABASE_URL)
      }
      if (!viteEnv.VITE_SUPABASE_ANON_KEY && allEnv.SUPABASE_ANON_KEY) {
        config.define = config.define || {}
        config.define['import.meta.env.VITE_SUPABASE_ANON_KEY'] = JSON.stringify(allEnv.SUPABASE_ANON_KEY)
      }
    },
  })

  return {
    envDir: backendDir,
    base: '/',
    plugins: [painelScopedAtAlias(), react(), tailwindcss(), injectEnvPlugin()],
    resolve: {
      alias: {
        '@': painelSrc,
        '@niochat': painelSrc,
        '@superadmin': path.resolve(__dirname, './src'),
        react: path.resolve(__dirname, './node_modules/react'),
        'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
        'react-dom/client': path.resolve(__dirname, './node_modules/react-dom/client'),
        'react/jsx-runtime': path.resolve(__dirname, './node_modules/react/jsx-runtime'),
        'react/jsx-dev-runtime': path.resolve(__dirname, './node_modules/react/jsx-dev-runtime'),
      },
      dedupe: ['react', 'react-dom', 'react-dom/client'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      minify: 'terser',
      rollupOptions: {
        output: {
          manualChunks: {
            ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
          },
        },
      },
      commonjsOptions: { transformMixedEsModules: true },
    },
    optimizeDeps: {
      exclude: ['pdfjs-dist'],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
      force: true,
      esbuildOptions: { define: { global: 'globalThis' } },
    },
    server: {
      host: '0.0.0.0',
      port: 8013,
      strictPort: false,
      allowedHosts: ['chat.niohub.com.br', 'localhost', '127.0.0.1'],
      cors: true,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
      },
      proxy: {
        '/api': { target: 'http://localhost:8010', changeOrigin: true, secure: false },
        '/api-token-auth': { target: 'http://localhost:8010', changeOrigin: true, secure: false },
        '/auth': { target: 'http://localhost:8010/api', changeOrigin: true, secure: false },
        '/webhook': { target: 'http://localhost:8010', changeOrigin: true, secure: false },
        '/webhooks': { target: 'http://localhost:8010', changeOrigin: true, secure: false },
        '/media': { target: 'http://localhost:8010', changeOrigin: true, secure: false },
        '/ws': { target: 'ws://localhost:8010', ws: true, changeOrigin: true, secure: false },
      },
    },
  }
})
