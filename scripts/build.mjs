import {execFileSync} from "node:child_process"
import {existsSync, readFileSync} from "node:fs"
import {copyFile, mkdir, readdir, rm, writeFile} from "node:fs/promises"
import {dirname, join, relative, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {build} from "vite"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const watch = process.argv.includes("--watch")

function revision(directory) {
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

function resolvePackageFile(specifier) {
	try {
		return fileURLToPath(import.meta.resolve(specifier))
	} catch {
		return undefined
	}
}

function resolvedPackage(name) {
	let directory = dirname(fileURLToPath(import.meta.resolve(name)))
	while (dirname(directory) !== directory) {
		const manifest = join(directory, "package.json")
		if (existsSync(manifest)) {
			const pkg = JSON.parse(readFileSync(manifest, "utf8"))
			if (pkg.name === name) return pkg
		}
		directory = dirname(directory)
	}
	throw new Error(`Could not find ${name}/package.json`)
}

function installedBase() {
	for (const name of ["@inkandswitch/patchwork-pkg-base"]) {
		const manifest = resolvePackageFile(`${name}/package.json`)
		if (!manifest) continue
		const packageRoot = dirname(manifest)
		const staticDist = join(packageRoot, "static-dist")
		return {
			directory: existsSync(staticDist) ? staticDist : packageRoot,
			name,
			version: JSON.parse(readFileSync(manifest, "utf8")).version,
		}
	}
	throw new Error("No Patchwork base package is installed")
}

function baseSource() {
	if (!process.env.PATCHWORK_BASE_DIR) return installedBase()
	const checkout = resolve(process.env.PATCHWORK_BASE_DIR)
	const directory = join(checkout, "static-dist")
	if (!existsSync(join(directory, "modules.json"))) {
		throw new Error(`No built base bundle at ${directory}`)
	}
	return {
		directory,
		name: "checkout",
		revision: revision(checkout),
	}
}

async function copyBase(source, outDir, previous = new Set()) {
	const entries = await readdir(source, {
		recursive: true,
		withFileTypes: true,
	})
	const files = new Set()
	for (const entry of entries) {
		if (
			!entry.isFile() ||
			entry.name === "_headers" ||
			entry.name === ".watch-ready"
		) {
			continue
		}
		const from = join(entry.parentPath, entry.name)
		const path = relative(source, from)
		files.add(path)
		const to = join(outDir, path)
		await mkdir(dirname(to), {recursive: true})
		await copyFile(from, to)
	}
	for (const path of previous) {
		if (!files.has(path)) await rm(join(outDir, path), {force: true})
	}
	return files
}

function coreSource() {
	if (!process.env.PATCHWORK_CORE_DIR) {
		return {
			name: "@inkandswitch/patchwork",
			version: resolvedPackage("@inkandswitch/patchwork").version,
		}
	}
	const directory = resolve(process.env.PATCHWORK_CORE_DIR)
	return {name: "checkout", revision: revision(directory)}
}

function environmentPlugin(base) {
	let outDir
	let copied = new Set()
	let copying = Promise.resolve()
	return {
		name: "patchwork-environment",
		apply: "build",
		configResolved(config) {
			outDir = resolve(config.root, config.build.outDir)
		},
		async closeBundle() {
			copying = copying.then(async () => {
				copied = await copyBase(base.directory, outDir, copied)
			})
			await copying
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
					},
					null,
					2
				)}\n`
			)
		},
		watchBase() {
			const ready = join(base.directory, ".watch-ready")
			let modified = existsSync(ready) ? readFileSync(ready, "utf8") : undefined
			return setInterval(() => {
				if (!existsSync(ready)) return
				const next = readFileSync(ready, "utf8")
				if (next === modified) return
				modified = next
				copying = copying
					.then(async () => {
						copied = await copyBase(base.directory, outDir, copied)
					})
					.catch(error => {
						console.error(error)
					})
			}, 500)
		},
	}
}

const base = baseSource()
const environment = environmentPlugin(base)
await build({
	root,
	build: watch ? {watch: {}} : undefined,
	plugins: [environment],
})
if (watch && process.env.PATCHWORK_BASE_DIR) environment.watchBase()
