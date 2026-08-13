import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Configuración especial para que funcione en GitHub Codespaces
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Obliga a abrir la puerta a todas las conexiones
    port: 5173,
    strictPort: false,
    cors: false,
    hmr: {
      clientPort: 443 // Le dice a GitHub que use su puerto seguro
    }
  }
})