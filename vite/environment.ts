import type {Plugin} from "vite"
import {readFile} from "node:fs/promises"
import {join, resolve} from "node:path"
import {pathToFileURL} from "node:url"

const systemDirectory =
	process.env.PATCHWORK_SYSTEM_DIRECTORY ?? process.env.PATCHWORK_CORE_DIR
const pkgBaseDirectory =
	process.env.PATCHWORK_PKG_BASE_DIRECTORY ?? process.env.PATCHWORK_BASE_DIR

export const core = systemDirectory ? resolve(systemDirectory) : undefined
export const base = pkgBaseDirectory ? resolve(pkgBaseDirectory) : undefined

export const {default: patchwork} = await import(
	core
		? pathToFileURL(
				join(core, "core", "patchwork", "dist", "vite", "patchwork-plugin.js")
			).href
		: "@inkandswitch/patchwork/vite"
)

/**
 * Points the site at a PATCHWORK_SYSTEM_DIRECTORY checkout: its build of
 * patchwork instead of the installed one, and its stylesheets instead of the
 * ones the patchwork plugin resolves from node_modules. Runs before that
 * plugin so its dev middleware registers first and wins.
 *
 * Without the environment variable this does nothing at all — everything else
 * a site needs is the patchwork plugin's own.
 */
export function environment(): Plugin | undefined {
	if (!core) return
	const patchworkCSS = join(core, "core", "patchwork", "dist", "global.css")
	const bootloaderCSS = join(core, "core", "bootloader", "dist", "global.css")
	return {
		name: "patchwork-environment",
		config() {
			return {
				resolve: {
					alias: [
						{
							find: /^@inkandswitch\/patchwork$/,
							replacement: join(core, "core", "patchwork", "dist", "index.js"),
						},
						{
							find: /^@inkandswitch\/patchwork\/global\.css$/,
							replacement: patchworkCSS,
						},
					],
				},
			}
		},
		configureServer(server) {
			server.middlewares.use(async (request, response, next) => {
				const pathname = request.url?.split("?")[0]
				if (
					pathname !== "/@inkandswitch/patchwork/global.css" &&
					pathname !== "/@inkandswitch/patchwork-bootloader/global.css"
				) {
					return next()
				}
				const bootloader = pathname.includes("bootloader")
				const css = await readFile(bootloader ? bootloaderCSS : patchworkCSS, "utf8")
				response.setHeader("Cache-Control", "no-cache")
				response.setHeader("Content-Type", "text/css")
				response.end(
					bootloader
						? css
						: css.replace(
								'"@inkandswitch/patchwork-bootloader/global.css"',
								'"/@inkandswitch/patchwork-bootloader/global.css"'
							)
				)
			})
		},
	}
}
