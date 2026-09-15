import {copyFileSync} from "node:fs"
import {createRequire} from "node:module"
import {dirname, join, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {defineConfig, type Plugin} from "vite"
import {base, core, environment, patchwork} from "./vite/environment.ts"

const root = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const patchworkRequire = createRequire(
	fileURLToPath(import.meta.resolve("@inkandswitch/patchwork"))
)
const automergeRepoRequire = createRequire(
	patchworkRequire.resolve("@automerge/automerge-repo")
)
const automergeWasm = automergeRepoRequire.resolve(
	"@automerge/automerge/automerge.wasm"
)

function repoAutomergeWasm(): Plugin {
	return {
		name: "repo-automerge-wasm",
		writeBundle(options) {
			const outputPath = resolve(
				root,
				options.file ?? join(options.dir ?? "dist", "index.html")
			)
			copyFileSync(
				automergeWasm,
				join(dirname(outputPath), "automerge.wasm")
			)
		},
	}
}

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
							idFactory: false
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
			buildInfo: {
				packageListURL: process.env.PATCHWORK_SYSTEM_PACKAGE_LIST_URL,
			},
		}),
		repoAutomergeWasm(),
	],
})
