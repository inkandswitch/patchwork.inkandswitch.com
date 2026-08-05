import type {Plugin} from "vite"
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
 * patchwork instead of the installed one. In dev the patchwork plugin is
 * already the checkout's own, so the stylesheets it serves are the checkout's
 * too; these aliases are what the build needs.
 *
 * Without the environment variable this does nothing at all — everything else
 * a site needs is the patchwork plugin's own.
 */
export function environment(): Plugin | undefined {
	if (!core) return
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
							replacement: join(core, "core", "patchwork", "dist", "global.css"),
						},
					],
				},
			}
		},
	}
}
