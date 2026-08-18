import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		VitePWA({
			strategies: 'injectManifest',
			srcDir: 'src',
			filename: 'sw.ts',
			registerType: 'prompt',
			injectRegister: false,
			// Ruční manifest schválně nemá theme_color; ten se mění podle motivu.
			manifest: false,
			injectManifest: {
				globPatterns: ['**/*.{js,css,html,png,svg,woff2,webmanifest}'],
				maximumFileSizeToCacheInBytes: 700_000,
			},
			devOptions: { enabled: true, type: 'module' },
		}),
	],
	resolve: {
		// Musí odpovídat `paths` v tsconfig.json, jinak typy sedí a build spadne.
		alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
	},
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
	preview: {
		port: 4173,
		proxy: { '/api': 'http://localhost:8080' },
	},
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/test-setup.ts'],
	},
})
