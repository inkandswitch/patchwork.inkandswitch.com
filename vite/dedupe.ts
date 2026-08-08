import type {Plugin, ViteDevServer} from "vite"
import {relative} from "node:path"

/**
 * The patchwork importmap points bare specifiers at `/@id/<dep>` so runtime
 * package code can resolve them. Vite 8 serves an optimized dep's contents at
 * that URL rather than redirecting to `/node_modules/.vite/deps/<dep>.js?v=…`,
 * so anything imported both ways — solid-js, imported by the site through the
 * canonical URL and by tools through the importmap — is evaluated twice, and
 * solid's owner/context state is per-evaluation. Pointing the importmap at the
 * canonical URL collapses them back into one.
 */
export function dedupe(): Plugin {
	let server: ViteDevServer | undefined
	return {
		name: "patchwork-dedupe-optimized-deps",
		apply: "serve",
		configureServer(dev) {
			server = dev
		},
		transformIndexHtml: {
			order: "post",
			async handler(html) {
				const optimizer = server?.environments.client.depsOptimizer
				if (!optimizer) return html
				await optimizer.init()
				const root = server!.config.root
				return html.replace(/"\/@id\/([^"]+)"/g, (match, id) => {
					const info = optimizer.metadata.optimized[id]
					if (!info) return match
					return `"/${relative(root, info.file)}?v=${info.browserHash}"`
				})
			},
		},
	}
}
