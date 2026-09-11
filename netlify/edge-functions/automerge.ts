import type {Config, Context} from "https://edge.netlify.com/v1/index.ts"
import {hasHeads, initializeWasm} from "@automerge/automerge/slim"
import * as subduction from "@automerge/automerge-subduction/slim"
import {
	Repo,
	isValidAutomergeUrl,
	parseAutomergeUrl,
	stringifyAutomergeUrl,
	type Chunk,
	type DocHandle,
	type PeerId,
	type StorageAdapterInterface,
	type StorageKey,
} from "@automerge/automerge-repo/slim"
import {resolvePath} from "@inkandswitch/patchwork-filesystem"

const {MemorySigner} = subduction
const initSubduction = (
	subduction as unknown as {initSync(bytes: Uint8Array): void}
).initSync

const SYNC_SERVER =
	Netlify.env.get("PATCHWORK_SYNC_SERVER") ??
	"wss://subduction.sync.inkandswitch.com"

const RESOLVE_TIMEOUT_MS = 20_000
const IMMUTABLE = "public, max-age=31536000, immutable"

const SEPARATOR = "\u0000"

class MemoryStorage implements StorageAdapterInterface {
	#chunks = new Map<string, Chunk>()

	async load(key: StorageKey) {
		return this.#chunks.get(key.join(SEPARATOR))?.data
	}

	async save(key: StorageKey, data: Uint8Array) {
		this.#chunks.set(key.join(SEPARATOR), {key, data})
	}

	async remove(key: StorageKey) {
		this.#chunks.delete(key.join(SEPARATOR))
	}

	async loadRange(keyPrefix: StorageKey) {
		const chunks: Chunk[] = []
		for (const [key, chunk] of this.#chunks) {
			if (this.#matches(key, keyPrefix)) chunks.push(chunk)
		}
		return chunks
	}

	async removeRange(keyPrefix: StorageKey) {
		for (const key of [...this.#chunks.keys()]) {
			if (this.#matches(key, keyPrefix)) this.#chunks.delete(key)
		}
	}

	async saveBatch(entries: Array<[StorageKey, Uint8Array]>) {
		for (const [key, data] of entries) await this.save(key, data)
	}

	#matches(key: string, keyPrefix: StorageKey) {
		const prefix = keyPrefix.join(SEPARATOR)
		return key === prefix || key.startsWith(prefix + SEPARATOR)
	}
}

let booting: Promise<Repo> | undefined

function getRepo(origin: string): Promise<Repo> {
	if (!booting) {
		booting = boot(origin)
		booting.catch(() => {
			booting = undefined
		})
	}
	return booting
}

async function bytes(url: URL): Promise<Uint8Array> {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`couldn't fetch ${url}: ${response.status}`)
	return new Uint8Array(await response.arrayBuffer())
}

async function boot(origin: string): Promise<Repo> {
	const [automergeWasm, subductionWasm] = await Promise.all([
		bytes(new URL("/automerge.wasm", origin)),
		bytes(new URL("/subduction.wasm", origin)),
	])
	initSubduction(subductionWasm)
	await initializeWasm(automergeWasm)

	return new Repo({
		peerId: `patchwork-edge-${crypto.randomUUID()}` as PeerId,
		signer: new MemorySigner(),
		storage: new MemoryStorage(),
		subductionWebsocketEndpoints: [SYNC_SERVER],
		async sharePolicy() {
			return false
		},
	})
}

function waitForHeads(
	handle: DocHandle<unknown>,
	hexHeads: string[],
	signal: AbortSignal
): Promise<boolean> {
	if (hasHeads(handle.doc(), hexHeads)) return Promise.resolve(true)
	if (signal.aborted) return Promise.resolve(false)
	return new Promise(resolve => {
		const cleanup = () => {
			handle.off("heads-changed", check)
			signal.removeEventListener("abort", onAbort)
		}
		const check = () => {
			if (!hasHeads(handle.doc(), hexHeads)) return
			cleanup()
			resolve(true)
		}
		const onAbort = () => {
			cleanup()
			resolve(false)
		}
		handle.on("heads-changed", check)
		signal.addEventListener("abort", onAbort)
		check()
	})
}

function text(body: string, status: number): Response {
	return new Response(body, {
		status,
		headers: {
			"content-type": "text/plain",
			"access-control-allow-origin": "*",
		},
	})
}

async function resolve(
	automergeURL: URL,
	origin: string,
	signal: AbortSignal
): Promise<Response> {
	const repo = await getRepo(origin)
	const [url, ...path] = automergeURL.href.split("/")

	if (!isValidAutomergeUrl(url)) return text("invalid automerge url", 400)

	if (path.length && !path[path.length - 1]) path.pop()

	const {heads, hexHeads, documentId} = parseAutomergeUrl(url)

	if (!heads) {
		const folder = await repo.find(url, {signal})
		const pinned = stringifyAutomergeUrl({documentId, heads: folder.heads()})
		const location = new URL(
			`/${encodeURIComponent(pinned)}${path.length ? `/${path.join("/")}` : ""}`,
			origin
		)
		return new Response(null, {
			status: 307,
			headers: {
				location: location.href,
				"cache-control": "no-store",
				"access-control-allow-origin": "*",
			},
		})
	}

	const handle = await repo.find(stringifyAutomergeUrl({documentId}), {signal})
	if (!(await waitForHeads(handle, hexHeads ?? [], signal))) {
		return text(
			`heads not found for ${url} within ${RESOLVE_TIMEOUT_MS}ms`,
			504
		)
	}

	const resolved = await resolvePath(
		repo,
		handle.view(heads),
		path.map(decodeURIComponent)
	)
	if (!resolved) {
		return text(`couldn't resolve ${path.join("/")} in ${url}`, 404)
	}

	return new Response(
		resolved.content instanceof Uint8Array
			? new Uint8Array(resolved.content)
			: resolved.content,
		{
			status: 200,
			headers: {
				"content-type": resolved.type,
				"cache-control": IMMUTABLE,
				"access-control-allow-origin": "*",
			},
		}
	)
}

export default async function automerge(
	request: Request,
	context: Context
): Promise<Response> {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return context.next()
	}

	const url = new URL(request.url)
	let handoff: URL
	try {
		handoff = new URL(decodeURIComponent(url.pathname.slice(1)))
	} catch {
		return context.next()
	}
	if (handoff.protocol !== "automerge:") return context.next()

	const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS)
	let response: Response
	try {
		response = await resolve(handoff, url.origin, signal)
	} catch (error) {
		console.error(`error resolving ${request.url}`, error)
		response = text(
			error instanceof Error
				? `${error.message}\n\n${error.stack}`
				: String(error),
			signal.aborted ? 504 : 500
		)
	}

	if (request.method !== "HEAD") return response
	return new Response(null, {status: response.status, headers: response.headers})
}

export const config: Config = {
	pattern: "^/automerge(:|%3[Aa])[^/]*(/.*)?$",
}
