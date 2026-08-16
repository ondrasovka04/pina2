import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [react(), tailwindcss()],
	build: {
		// Obsah dist/ se nahrává do public_html/ na hostingu.
		outDir: 'dist',
		sourcemap: true,
	},
	server: {
		port: 5173,
		proxy: {
			// Ve vývoji míří API na PHP kontejner, v produkci je na stejné doméně.
			'/api': 'http://localhost:8080',
		},
	},
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/test-setup.ts'],
	},
})
