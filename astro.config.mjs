import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig, fontProviders, sessionDrivers } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { fileURLToPath } from "node:url";

// Public origin (http://hub.local) comes from EMDASH_SITE_URL at runtime. `pnpm build` also sets it,
// because EmDash bakes the host into image.remotePatterns; without it media is never resized.
export default defineConfig({
	output: "server",
	adapter: node({
		mode: "standalone",
		// Default is 1 GB; EmDash media uploads cap at 50 MB, so leave room for multipart overhead only.
		bodySizeLimit: 64 * 1024 * 1024,
	}),
	// The adapter default bakes the build machine's absolute cache path into dist;
	// a relative base resolves against the service's WorkingDirectory instead.
	session: {
		driver: sessionDrivers.fsLite({ base: "./data/sessions" }),
	},
	// Downloaded at build time and self-hosted, so the LAN hub needs no font CDN.
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Big Shoulders",
			cssVariable: "--font-display",
			weights: ["700 800"],
			subsets: ["latin"],
			fallbacks: ["Arial Narrow", "sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "Atkinson Hyperlegible Next",
			cssVariable: "--font-body",
			weights: ["400 700"],
			styles: ["normal", "italic"],
			subsets: ["latin"],
			fallbacks: ["system-ui", "sans-serif"],
		},
	],
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: sqlite({ url: "file:./data/hub.db" }),
			storage: local({
				directory: "./data/uploads",
				baseUrl: "/_emdash/api/media/file",
			}),
			plugins: [
				{
					id: "hub-staff",
					version: "1.0.0",
					format: "native",
					entrypoint: fileURLToPath(new URL("./src/plugins/staff-pins.ts", import.meta.url)),
				},
				{
					id: "hub-jobs",
					version: "1.0.0",
					format: "native",
					entrypoint: fileURLToPath(new URL("./src/plugins/hub-jobs.ts", import.meta.url)),
				},
			],
		}),
	],
	devToolbar: { enabled: false },
});
