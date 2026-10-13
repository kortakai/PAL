import { defineConfig } from 'vite';
import packageJson from './package.json';

export default defineConfig({
  clearScreen: false,
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version)
  },
  server: {
    // Keep Vite's bind address aligned with Tauri's devUrl. On macOS,
    // "localhost" can resolve to ::1 while WKWebView requests IPv4.
    host: '127.0.0.1',
    port: 1420,
    strictPort: true
  },
  optimizeDeps: {
    // The hub intentionally imports small Lucide icons by deep path to keep
    // the production bundle lean. Serve those ESM modules directly in dev
    // instead of leaving Vite waiting on a deep-import optimization crawl.
    exclude: ['lucide-react']
  },
  envPrefix: ['VITE_', 'TAURI_']
});
