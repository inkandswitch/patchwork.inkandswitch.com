import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {defineConfig} from "vite"
import {base, core, environment, patchwork} from "./vite/environment.ts"

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	plugins: [
		environment(),
		patchwork({
			title: "Patchwork",
			description: "local-first collaborative malleable software environment",
			storagePrefix: "patchwork.inkandswitch.com",
			server: core ? {fs: {allow: [root, core]}} : undefined,
			keyhive:
				process.env.KEYHIVE === "true"
					? {
							syncServer:
								process.env.KEYHIVE_SYNC_SERVER === "true"
									? "keyhive"
									: "subduction",
							useIdFactory: false
						}
					: undefined,
			themeColor: {light: "#f8f8f8", dark: "#181e24"},
			icons: {
				source: process.env.PATCHWORK_FAVICON ?? "public/patchwork.svg",
				maskIcon: "public/mask.svg",
			},
			static: [
				base
					? {from: join(base, "static-dist"), watch: ".watch-ready"}
					: "@inkandswitch/patchwork-pkg-base",
			],
			// vite's cors middleware adds `Vary: Origin`, which netlify doesn't
			// send; the service worker then caches the crossorigin wasm preloads
			// under that Vary and offline boot misses them. The patchwork plugin
			// already sends `Access-Control-Allow-Origin: *`.
			preview: {cors: false},
			buildInfo: {
				packageListURL: process.env.PATCHWORK_SYSTEM_PACKAGE_LIST_URL,
			},
		}),
	],
})
