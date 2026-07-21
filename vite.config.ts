import {copyFile, mkdir, readdir} from "node:fs/promises"
import {constants} from "node:fs"
import {dirname, join, relative, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {defineConfig, type Plugin} from "vite"

const {default: patchwork} = await import("@inkandswitch/patchwork/vite")

function packages(): Plugin {
	let outDir: string
	return {
		name: "patchwork-pkg-base",
		apply: "build",
		configResolved(config) {
			outDir = resolve(config.root, config.build.outDir)
		},
		async closeBundle() {
			const src = fileURLToPath(
				new URL(
					".",
					import.meta.resolve("@inkandswitch/patchwork-pkg-base/package.json")
				)
			)
			const entries = await readdir(src, {
				recursive: true,
				withFileTypes: true,
			})
			for (const entry of entries) {
				if (!entry.isFile() || entry.name === "_headers") continue
				const from = join(entry.parentPath, entry.name)
				const to = join(outDir, relative(src, from))
				await mkdir(dirname(to), {recursive: true})
				await copyFile(from, to, constants.COPYFILE_EXCL)
			}
		},
	}
}

export default defineConfig({
	plugins: [
		packages(),
		patchwork({
			siteName: "patchwork.inkandswitch.com",
			title: "Patchwork",
			description: "local-first collaborative malleable software environment",
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
				source: "public/patchwork.svg",
				maskIcon: "public/mask.svg",
			},
		}),
	],
})
