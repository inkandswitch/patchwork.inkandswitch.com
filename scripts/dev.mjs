import {spawn, spawnSync} from "node:child_process"
import {existsSync, readFileSync} from "node:fs"
import {dirname, join, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {stripVTControlCharacters} from "node:util"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const children = []
const processGroups = process.platform !== "win32"
const footerLines = 3
const footer = process.stdout.isTTY && process.stdout.rows > footerLines
let stopping = false
let footerVisible = false
let devURL = "Vite starting…"
let corePackages = ""
let basePackages = ""

function showFooter() {
	if (!footer) return
	const row = process.stdout.rows
	const start = row - footerLines + 1
	const lines = [
		["Patchwork site", devURL],
		["Patchwork core packages", corePackages],
		["Patchwork base packages", basePackages],
	]
	process.stdout.write(
		`\x1b[r\x1b[1;${start - 1}r\x1b[?7l${lines
			.map(
				([label, value], index) =>
					`\x1b[${start + index};1H\x1b[2K\x1b[2m${label}:\x1b[0m \x1b[36m${value}\x1b[0m`
			)
			.join("")}\x1b[?7h\x1b[${start - 1};1H`
	)
	footerVisible = true
}

function hideFooter() {
	if (!footerVisible) return
	const start = process.stdout.rows - footerLines + 1
	process.stdout.write(
		`\x1b[r\x1b[?7h${Array.from(
			{length: footerLines},
			(_, index) => `\x1b[${start + index};1H\x1b[2K`
		).join("")}`
	)
	footerVisible = false
}

function checkout(variable, names) {
	if (process.env[variable]) return resolve(process.env[variable])
	return names
		.map(name => resolve(root, "..", name))
		.find(directory => existsSync(join(directory, "package.json")))
}

function packageVersion(name) {
	let entry
	try {
		entry = import.meta.resolve(`${name}/package.json`)
	} catch {
		entry = import.meta.resolve(name)
	}
	let directory = dirname(fileURLToPath(entry))
	while (dirname(directory) !== directory) {
		const manifest = join(directory, "package.json")
		if (existsSync(manifest)) {
			const pkg = JSON.parse(readFileSync(manifest, "utf8"))
			if (pkg.name === name) return pkg.version
		}
		directory = dirname(directory)
	}
	throw new Error(`Could not find ${name}/package.json`)
}

function run(name, command, args, cwd, env = process.env) {
	const child = spawn(command, args, {
		cwd,
		env,
		stdio: footer ? ["inherit", "pipe", "pipe"] : "inherit",
		detached: processGroups,
	})
	if (footer) {
		child.stdout.pipe(process.stdout, {end: false})
		child.stderr.pipe(process.stderr, {end: false})
	}
	children.push(child)
	child.on("exit", (code, signal) => {
		if (stopping) return
		process.exitCode = code ?? (signal ? 1 : 0)
		stop()
	})
	child.on("error", error => {
		console.error(`${name}: ${error.message}`)
		process.exitCode = 1
		stop()
	})
	return child
}

function ensure(path, command, args, cwd, env = process.env) {
	if (existsSync(path)) return
	build(command, args, cwd, env)
}

function build(command, args, cwd, env = process.env) {
	const child = spawnSync(command, args, {cwd, env, stdio: "inherit"})
	if (child.status !== 0) process.exit(child.status ?? 1)
}

function ensureBase(directory) {
	if (existsSync(join(directory, "static-dist", "modules.json"))) return
	for (const [command, args] of [
		["pnpm", ["-r", "--if-present", "build"]],
		["node", ["scripts/bundle.mjs"]],
	]) {
		const child = spawnSync(command, args, {
			cwd: directory,
			stdio: "inherit",
		})
		if (child.status !== 0) process.exit(child.status ?? 1)
	}
}

function stop() {
	if (stopping) return
	stopping = true
	process.stdout.off("resize", showFooter)
	hideFooter()
	for (const child of children) {
		if (child.exitCode !== null || child.killed) continue
		try {
			if (processGroups && child.pid) process.kill(-child.pid, "SIGTERM")
			else child.kill("SIGTERM")
		} catch (error) {
			if (error.code !== "ESRCH") throw error
		}
	}
	if (!children.some(child => child.exitCode === null)) process.exit()
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)
process.on("exit", hideFooter)

const core = checkout("PATCHWORK_CORE_DIR", ["core", "patchwork-next"])
const base = checkout("PATCHWORK_BASE_DIR", ["base", "patchwork-base"])
corePackages = core ?? packageVersion("@inkandswitch/patchwork")
basePackages = base ?? packageVersion("@inkandswitch/patchwork-pkg-base")
const env = {
	...process.env,
	...(core ? {PATCHWORK_CORE_DIR: core} : {}),
	...(base ? {PATCHWORK_BASE_DIR: base} : {}),
}
const watchEnv = {
	...env,
	PNPM_CONFIG_REPORTER: process.env.PNPM_CONFIG_REPORTER ?? "append-only",
}

if (core) {
	ensure(
		join(core, "core", "patchwork", "dist", "vite", "patchwork-plugin.js"),
		"pnpm",
		["--filter", "@inkandswitch/patchwork...", "build"],
		core
	)
}

if (base) {
	ensureBase(base)
}

build("pnpm", ["exec", "vite", "build"], root, env)
if (core) run("core", "pnpm", ["watch"], core, watchEnv)
if (base) run("base", "pnpm", ["watch"], base, watchEnv)
const site = run("site", "pnpm", ["exec", "vite"], root, watchEnv)
let siteOutput = ""
site.stdout?.on("data", chunk => {
	siteOutput = `${siteOutput}${stripVTControlCharacters(chunk.toString())}`
	const match = siteOutput.match(/Local:\s+(https?:\/\/\S+)/)
	if (match) {
		devURL = match[1]
		showFooter()
		siteOutput = ""
	} else {
		siteOutput = siteOutput.slice(-2048)
	}
})
process.stdout.on("resize", showFooter)
showFooter()
