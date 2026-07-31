import type {Plugin} from "vite"
import {execFileSync} from "node:child_process"
import {existsSync, readFileSync} from "node:fs"
import {
	copyFile,
	mkdir,
	readFile,
	readdir,
	stat,
	writeFile,
} from "node:fs/promises"
import {dirname, extname, join, relative, resolve} from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"

const systemDirectory =
	process.env.PATCHWORK_SYSTEM_DIRECTORY ?? process.env.PATCHWORK_CORE_DIR
const pkgBaseDirectory =
	process.env.PATCHWORK_PKG_BASE_DIRECTORY ?? process.env.PATCHWORK_BASE_DIR

export const core = systemDirectory ? resolve(systemDirectory) : undefined

export const {default: patchwork} = await import(
	core
		? pathToFileURL(
				join(core, "core", "patchwork", "dist", "vite", "patchwork-plugin.js")
			).href
		: "@inkandswitch/patchwork/vite"
)

function revision(directory: string) {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: directory,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim()
	} catch {
		return undefined
	}
}

function packageDirectory(name: string) {
	try {
		return dirname(fileURLToPath(import.meta.resolve(`${name}/package.json`)))
	} catch {
		// packages with an "exports" map don't necessarily expose their manifest
		let directory = dirname(fileURLToPath(import.meta.resolve(name)))
		while (dirname(directory) !== directory) {
			const manifest = join(directory, "package.json")
			if (
				existsSync(manifest) &&
				JSON.parse(readFileSync(manifest, "utf8")).name === name
			) {
				return directory
			}
			directory = dirname(directory)
		}
		throw new Error(`Could not find ${name}/package.json`)
	}
}

function coreSource() {
	if (!core) {
		const manifest = join(
			packageDirectory("@inkandswitch/patchwork"),
			"package.json"
		)
		return {
			name: "@inkandswitch/patchwork",
			version: JSON.parse(readFileSync(manifest, "utf8")).version,
		}
	}
	return {name: "checkout", revision: revision(core)}
}

function baseSource(): {
	directory: string
	name: string
	version?: string
	revision?: string
} {
	if (pkgBaseDirectory) {
		const checkout = resolve(pkgBaseDirectory)
		const directory = join(checkout, "static-dist")
		if (!existsSync(join(directory, "modules.json"))) {
			throw new Error(`No built base bundle at ${directory}`)
		}
		return {directory, name: "checkout", revision: revision(checkout)}
	}
	const name = "@inkandswitch/patchwork-pkg-base"
	const packageRoot = packageDirectory(name)
	const staticDist = join(packageRoot, "static-dist")
	return {
		directory: existsSync(staticDist) ? staticDist : packageRoot,
		name,
		version: JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
			.version,
	}
}

const IGNORED = new Set(["_headers", ".watch-ready"])
const CONTENT_TYPES: Record<string, string> = {
	".css": "text/css",
	".html": "text/html",
	".js": "text/javascript",
	".json": "application/json",
	".map": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".wasm": "application/wasm",
}

async function baseFiles(
	source: string,
	directory = source
): Promise<string[]> {
	const files: string[] = []
	for (const entry of await readdir(directory, {withFileTypes: true})) {
		const path = join(directory, entry.name)
		if (entry.isDirectory()) files.push(...(await baseFiles(source, path)))
		if (entry.isFile() && !IGNORED.has(entry.name)) {
			files.push(relative(source, path))
		}
	}
	return files
}

/**
 * Points the site at a PATCHWORK_SYSTEM_DIRECTORY checkout when there is one,
 * serves the base tools bundle (modules.json + packages/) in dev, copies it
 * alongside the built shell, and records what everything was built from. With
 * PATCHWORK_PKG_BASE_DIRECTORY set, base's own watcher touches .watch-ready
 * after each rebuild, which reloads the page.
 *
 * Runs before the patchwork plugin so a checkout's stylesheets win over the
 * ones that plugin resolves from node_modules.
 */
export function environment(): Plugin {
	const base = baseSource()
	const stylesheets = new Map(
		core
			? [
					[
						"/@inkandswitch/patchwork/global.css",
						join(core, "core", "patchwork", "dist", "global.css"),
					],
					[
						"/@inkandswitch/patchwork-bootloader/global.css",
						join(core, "core", "bootloader", "dist", "global.css"),
					],
				]
			: []
	)
	let root: string
	let outDir: string
	return {
		name: "patchwork-environment",
		config() {
			if (!core) return
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
		configResolved(config) {
			root = config.root
			outDir = resolve(config.root, config.build.outDir)
		},
		async closeBundle() {
			for (const path of await baseFiles(base.directory)) {
				const to = join(outDir, path)
				await mkdir(dirname(to), {recursive: true})
				await copyFile(join(base.directory, path), to)
			}

			await writeFile(
				join(outDir, "build-info.json"),
				`${JSON.stringify(
					{
						site: {revision: revision(root)},
						core: coreSource(),
						base: {
							name: base.name,
							version: base.version,
							revision: base.revision,
						},
						packageListURL: process.env.PATCHWORK_SYSTEM_PACKAGE_LIST_URL,
					},
					null,
					2
				)}\n`
			)
		},
		configureServer(server) {
			const ready = join(base.directory, ".watch-ready")
			server.watcher.add(ready)
			server.watcher.on("change", path => {
				if (path === ready) server.ws.send({type: "full-reload"})
			})
			server.middlewares.use(async (request, response, next) => {
				try {
					const pathname = decodeURIComponent(
						new URL(request.url ?? "/", "http://localhost").pathname
					)
					const stylesheet = stylesheets.get(pathname)
					if (stylesheet) {
						response.setHeader("Cache-Control", "no-cache")
						response.setHeader("Content-Type", "text/css")
						const css = await readFile(stylesheet, "utf8")
						response.end(
							pathname === "/@inkandswitch/patchwork/global.css"
								? css.replace(
										'"@inkandswitch/patchwork-bootloader/global.css"',
										'"/@inkandswitch/patchwork-bootloader/global.css"'
									)
								: css
						)
						return
					}
					const path = resolve(base.directory, `.${pathname}`)
					if (
						!relative(base.directory, path).startsWith("..") &&
						(await stat(path)).isFile()
					) {
						response.setHeader("Cache-Control", "no-cache")
						response.setHeader(
							"Content-Type",
							CONTENT_TYPES[extname(path)] ?? "application/octet-stream"
						)
						response.end(await readFile(path))
						return
					}
					next()
				} catch {
					next()
				}
			})
		},
	}
}
