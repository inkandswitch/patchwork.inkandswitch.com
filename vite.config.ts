import {copyFile} from "node:fs/promises"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {defineConfig, type Plugin} from "vite"
import {base, core, environment, patchwork} from "./vite/environment.ts"

const root = dirname(fileURLToPath(import.meta.url))

// The site syncs through its own server (netlify/server), which peers with
// the main one. Each deploy dials its own, and says which host it dialled,
// since that is the service name and the server can't see it for the proxy.
// Without Netlify (a bare `pnpm dev`) there is no server here, so the main
// one it is.
const site =
	process.env.CONTEXT == "production"
		? process.env.URL
		: (process.env.DEPLOY_PRIME_URL ?? process.env.URL)
const subductionSyncServer =
	process.env.SUBDUCTION_SYNC_SERVER ??
	(site &&
		`${site.replace(/^http/, "ws")}/sync-server?host=${new URL(site).host}`)

/**
 * Netlify puts rewrites ahead of the sync server, so patchwork's SPA fallback
 * (`/* /index.html 200`) would answer /sync-server with the app. Routing is
 * all in the hash anyway, so the fallback goes, and a 404.html that is the
 * app covers any other path. The rest of _redirects stays: it sends the
 * fixed paths patchwork's files used to have (/automerge.wasm,
 * /packages/…) to the hashed names they have now.
 */
function syncServerRoute(): Plugin {
	let outDir = ""
	return {
		name: "sync-server-route",
		apply: "build",
		configResolved(config) {
			outDir = config.build.outDir
		},
		generateBundle(_, bundle) {
			const redirects = bundle["_redirects"]
			if (redirects?.type != "asset") return
			redirects.source = String(redirects.source)
				.split("\n")
				.filter(line => !line.startsWith("/* "))
				.join("\n")
		},
		async closeBundle() {
			await copyFile(join(outDir, "index.html"), join(outDir, "404.html"))
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
			syncServers: subductionSyncServer
				? {subduction: subductionSyncServer}
				: undefined,
			server: core ? {fs: {allow: [root, core]}} : undefined,
			keyhive:
				process.env.KEYHIVE === "true"
					? {
							syncServer:
								process.env.KEYHIVE_SYNC_SERVER === "true"
									? "keyhive"
									: "subduction",
							useIdFactory: false,
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
		syncServerRoute(),
	],
})
