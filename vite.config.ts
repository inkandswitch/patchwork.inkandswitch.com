import {defineConfig} from "vite"
import {dirname} from "node:path"
import {fileURLToPath} from "node:url"
import {core, environment, patchwork} from "./vite/environment.ts"

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	plugins: [
		environment(),
		patchwork({
			title: "Patchwork",
			description: "local-first collaborative malleable software environment",
			server: core ? {fs: {allow: [root, core]}} : undefined,
			syncServers:
				process.env.KEYHIVE === "true"
					? {
							keyhive:
								process.env.KEYHIVE_SYNC_SERVER === "true"
									? "keyhive"
									: "subduction",
						}
					: undefined,
			themeColor: {light: "#f8f8f8", dark: "#181e24"},
			icons: {
				source: process.env.PATCHWORK_FAVICON ?? "public/patchwork.svg",
				maskIcon: "public/mask.svg",
			},
		}),
	],
})
