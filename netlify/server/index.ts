/**
 * A subduction sync server for patchwork, run as a Netlify Server.
 *
 * Clients connect with a WebSocket to `/sync-server` and find this server by
 * discovery: the service name they sign for is the host they dialled, so its
 * own key doesn't need to be known in advance.
 *
 * Everything the server holds is kept in Netlify Blobs, in one store for the
 * whole site. Without a blobs
 * environment (plain `node`, say) it keeps it in memory instead, and says so.
 */
import {
	CommitId,
	CommitWithBlob,
	FragmentWithBlob,
	MemorySigner,
	MemoryStorage,
	type PeerId,
	SedimentreeId,
	SignedFragment,
	SignedLooseCommit,
	Subduction,
	type SedimentreeStorage,
	type Transport,
} from "@automerge/automerge-subduction"
import {getStore, type Store} from "@netlify/blobs"
import {
	getContext,
	onShutdown,
	upgradeWebSocket,
	type Config,
	type WebSocket,
} from "@netlify/server"

export const config: Config = {
	path: "/sync-server",
}

/**
 * Commits and fragments are each stored as one blob: the signed metadata and
 * the payload, with the metadata's length in front, so the two can never be
 * written apart.
 */
function pack(signed: Uint8Array, blob: Uint8Array) {
	const bytes = new Uint8Array(4 + signed.length + blob.length)
	new DataView(bytes.buffer).setUint32(0, signed.length)
	bytes.set(signed, 4)
	bytes.set(blob, 4 + signed.length)
	return bytes
}

function unpack(bytes: Uint8Array) {
	const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0)
	return {
		signed: bytes.subarray(4, 4 + length),
		blob: bytes.subarray(4 + length),
	}
}

class BlobsStorage implements SedimentreeStorage {
	#store: Store

	constructor(store: Store) {
		this.#store = store
	}

	async #get(key: string) {
		const data = await this.#store.get(key, {type: "arrayBuffer"})
		return data ? new Uint8Array(data) : null
	}

	async #keys(prefix: string) {
		const {blobs} = await this.#store.list({prefix})
		return blobs.map(blob => blob.key.slice(prefix.length))
	}

	async #deleteAll(prefix: string) {
		const {blobs} = await this.#store.list({prefix})
		await Promise.all(blobs.map(blob => this.#store.delete(blob.key)))
	}

	async saveSedimentreeId(id: SedimentreeId) {
		await this.#store.set(`ids/${id}`, "")
	}

	async deleteSedimentreeId(id: SedimentreeId) {
		await this.#store.delete(`ids/${id}`)
	}

	async loadAllSedimentreeIds() {
		const keys = await this.#keys("ids/")
		return keys.map(hex => SedimentreeId.fromBytes(fromHex(hex)))
	}

	async containsSedimentreeId(id: SedimentreeId) {
		return (await this.#store.getMetadata(`ids/${id}`)) != null
	}

	async saveCommit(
		id: SedimentreeId,
		commitId: CommitId,
		signed: SignedLooseCommit,
		blob: Uint8Array
	) {
		const bytes = pack(signed.encode(), blob).buffer
		await this.#store.set(`commits/${id}/${commitId.toHexString()}`, bytes)
	}

	async loadCommit(id: SedimentreeId, commitId: CommitId) {
		const bytes = await this.#get(`commits/${id}/${commitId.toHexString()}`)
		if (!bytes) return null
		const {signed, blob} = unpack(bytes)
		return new CommitWithBlob(SignedLooseCommit.tryDecode(signed), blob)
	}

	async listCommitIds(id: SedimentreeId) {
		const keys = await this.#keys(`commits/${id}/`)
		return keys.map(hex => CommitId.fromHexString(hex))
	}

	async loadAllCommits(id: SedimentreeId) {
		const ids = await this.listCommitIds(id)
		const commits = await Promise.all(ids.map(c => this.loadCommit(id, c)))
		return commits.filter(commit => commit != null)
	}

	async deleteCommit(id: SedimentreeId, commitId: CommitId) {
		await this.#store.delete(`commits/${id}/${commitId.toHexString()}`)
	}

	async deleteAllCommits(id: SedimentreeId) {
		await this.#deleteAll(`commits/${id}/`)
	}

	async saveFragment(
		id: SedimentreeId,
		head: CommitId,
		signed: SignedFragment,
		blob: Uint8Array
	) {
		const bytes = pack(signed.encode(), blob).buffer
		await this.#store.set(`fragments/${id}/${head.toHexString()}`, bytes)
	}

	async loadFragment(id: SedimentreeId, head: CommitId) {
		const bytes = await this.#get(`fragments/${id}/${head.toHexString()}`)
		if (!bytes) return null
		const {signed, blob} = unpack(bytes)
		return new FragmentWithBlob(SignedFragment.tryDecode(signed), blob)
	}

	async listFragmentIds(id: SedimentreeId) {
		const keys = await this.#keys(`fragments/${id}/`)
		return keys.map(hex => CommitId.fromHexString(hex))
	}

	async loadAllFragments(id: SedimentreeId) {
		const heads = await this.listFragmentIds(id)
		const fragments = await Promise.all(
			heads.map(head => this.loadFragment(id, head))
		)
		return fragments.filter(fragment => fragment != null)
	}

	async deleteFragment(id: SedimentreeId, head: CommitId) {
		await this.#store.delete(`fragments/${id}/${head.toHexString()}`)
	}

	async deleteAllFragments(id: SedimentreeId) {
		await this.#deleteAll(`fragments/${id}/`)
	}

	/**
	 * The id goes in last, so a tree is only listed once everything in it has
	 * been written.
	 */
	async saveBatchAll(
		id: SedimentreeId,
		commits: {
			commitId: CommitId
			signedCommit: SignedLooseCommit
			blob: Uint8Array
		}[],
		fragments: {
			fragmentHead: CommitId
			signedFragment: SignedFragment
			blob: Uint8Array
		}[]
	) {
		await Promise.all([
			...commits.map(c =>
				this.saveCommit(id, c.commitId, c.signedCommit, c.blob)
			),
			...fragments.map(f =>
				this.saveFragment(id, f.fragmentHead, f.signedFragment, f.blob)
			),
		])
		await this.saveSedimentreeId(id)
		return commits.length + fragments.length
	}
}

function fromHex(hex: string) {
	return Uint8Array.from(hex.match(/../g) ?? [], byte => parseInt(byte, 16))
}

function openStorage(): SedimentreeStorage {
	try {
		return new BlobsStorage(
			getStore({name: "subduction", consistency: "strong"})
		)
	} catch (error) {
		console.warn(
			"[subduction] no Netlify Blobs here, so nothing will outlive this process:",
			error
		)
		return new MemoryStorage()
	}
}

/**
 * A WebSocket as a subduction transport: one binary message is one frame, as
 * on the client. Works on the server's own sockets and on the WebSocket node
 * dials out with alike.
 */
class SocketTransport implements Transport {
	#socket: globalThis.WebSocket | WebSocket
	#queue: Uint8Array[] = []
	#waiting: {
		resolve: (bytes: Uint8Array) => void
		reject: (error: Error) => void
	}[] = []
	#isClosed = false
	#onDisconnect?: () => void
	#markClosed!: () => void
	/** Resolves when the socket is gone, for whatever reason. */
	closed = new Promise<void>(resolve => (this.#markClosed = resolve))

	constructor(socket: globalThis.WebSocket | WebSocket) {
		this.#socket = socket
		socket.binaryType = "arraybuffer"
		socket.addEventListener("message", event => {
			const {data} = event as MessageEvent
			if (this.#isClosed || typeof data == "string") return
			const bytes = new Uint8Array(data)
			const waiter = this.#waiting.shift()
			if (waiter) waiter.resolve(bytes)
			else this.#queue.push(bytes)
		})
		socket.addEventListener("close", () => this.#close())
		socket.addEventListener("error", () => this.#close())
	}

	/** Dials `url`, and resolves once the socket is open. */
	static connect(url: string) {
		return new Promise<SocketTransport>((resolve, reject) => {
			const socket = new globalThis.WebSocket(url)
			socket.addEventListener("open", () =>
				resolve(new SocketTransport(socket))
			)
			socket.addEventListener("error", () =>
				reject(new Error(`couldn't connect to ${url}`))
			)
		})
	}

	#close() {
		if (this.#isClosed) return
		this.#isClosed = true
		this.#queue = []
		const error = new Error("WebSocket closed")
		for (const waiter of this.#waiting.splice(0)) waiter.reject(error)
		this.#markClosed()
		this.#onDisconnect?.()
	}

	async sendBytes(bytes: Uint8Array) {
		if (this.#isClosed) throw new Error("WebSocket closed")
		this.#socket.send(bytes.slice())
	}

	recvBytes() {
		const queued = this.#queue.shift()
		if (queued) return Promise.resolve(queued)
		if (this.#isClosed) return Promise.reject(new Error("WebSocket closed"))
		return new Promise<Uint8Array>((resolve, reject) => {
			this.#waiting.push({resolve, reject})
		})
	}

	async disconnect() {
		this.#socket.close()
		this.#close()
	}

	onDisconnect(callback: () => void) {
		this.#onDisconnect = callback
	}
}

/**
 * This server is a peer of the main sync server, and everything goes both
 * ways: anything a client here asks for is fetched from upstream first, and
 * anything written here is sent upstream once it's stored. Upstream sends
 * along what changes there on the trees this server has asked about.
 */
class Upstream {
	#url: string
	#peerId: PeerId | null = null
	/** Trees fetched from upstream on this connection, or being fetched. */
	#pulled = new Map<string, Promise<unknown>>()
	#pushing = new Map<string, ReturnType<typeof setTimeout>>()

	constructor(url: string) {
		this.#url = url
	}

	is(peerId: PeerId) {
		return this.#peerId?.toString() == peerId.toString()
	}

	/** Stays connected, backing off between attempts, forever. */
	async run() {
		let backoff = 1000
		for (;;) {
			let transport: SocketTransport | null = null
			try {
				transport = await SocketTransport.connect(this.#url)
				this.#peerId = await subduction.connectTransport(
					transport,
					new URL(this.#url).host
				)
				console.log(`[subduction] connected upstream to ${this.#url}`)
				backoff = 1000
				// Send it everything we have and hear about all of it after.
				void subduction
					.fullSyncWithPeer(this.#peerId, true, UPSTREAM_TIMEOUT)
					.catch(error => console.warn("[subduction] upstream sync:", error))
				await transport.closed
				console.warn(`[subduction] lost upstream ${this.#url}`)
			} catch (error) {
				console.warn(`[subduction] upstream ${this.#url}:`, error)
				void transport?.disconnect()
			}
			this.#peerId = null
			this.#pulled.clear()
			await new Promise(resolve => setTimeout(resolve, backoff))
			backoff = Math.min(backoff * 2, 30_000)
		}
	}

	/**
	 * Fetches trees from upstream, at most once a connection each, so they're
	 * here by the time a client is answered. A slow upstream holds the client
	 * up for no longer than the timeout.
	 */
	async pull(ids: SedimentreeId[]) {
		const peerId = this.#peerId
		if (!peerId) return
		await Promise.all(
			ids.map(id => {
				const key = id.toString()
				let pulling = this.#pulled.get(key)
				if (!pulling) {
					pulling = subduction
						.syncWithPeer(peerId, id, true, UPSTREAM_TIMEOUT)
						.catch(error => {
							this.#pulled.delete(key)
							console.warn(`[subduction] pulling ${key}:`, error)
						})
					this.#pulled.set(key, pulling)
				}
				return pulling
			})
		)
	}

	/** Sends a tree upstream shortly after it last changed. */
	push(id: SedimentreeId) {
		const key = id.toString()
		clearTimeout(this.#pushing.get(key))
		this.#pushing.set(
			key,
			setTimeout(() => {
				this.#pushing.delete(key)
				const peerId = this.#peerId
				if (!peerId) return
				subduction
					.syncWithPeer(peerId, SedimentreeId.fromBytes(fromHex(key)), true)
					.catch(error => console.warn(`[subduction] pushing ${key}:`, error))
			}, PUSH_DELAY)
		)
	}
}

/**
 * Wraps storage so every tree written to is pushed upstream after. Pushing a
 * tree upstream just sent costs a comparison of heads and nothing more.
 */
function pushingWrites(storage: SedimentreeStorage): SedimentreeStorage {
	const writes = new Set<PropertyKey>([
		"saveCommit",
		"saveFragment",
		"saveBatchAll",
	])
	return new Proxy(storage, {
		get(target, key) {
			const value = Reflect.get(target, key)
			if (typeof value != "function") return value
			if (!writes.has(key)) return value.bind(target)
			return async (id: SedimentreeId, ...rest: unknown[]) => {
				const result = await value.call(target, id, ...rest)
				upstream.push(id)
				return result
			}
		},
	})
}

const UPSTREAM_URL = "wss://subduction.sync.inkandswitch.com"
const UPSTREAM_TIMEOUT = 10_000
const PUSH_DELAY = 250

const upstream = new Upstream(UPSTREAM_URL)
// Each process gets an identity of its own. Production, previews and every
// instance share one store, and they mustn't look like one peer upstream.
const signer = new MemorySigner()
const subduction = new Subduction({
	signer,
	storage: pushingWrites(openStorage()),
	policy: {
		async authorizeConnect() {},
		async authorizePut() {},
		async authorizeFetch(peerId, id) {
			if (!upstream.is(peerId)) await upstream.pull([id])
		},
		async filterAuthorizedFetch(peerId, ids) {
			if (!upstream.is(peerId)) await upstream.pull(ids)
			return ids
		},
	},
})
console.log(`[subduction] listening as ${signer.peerId()}`)
void upstream.run()

onShutdown(() => subduction.disconnectAll())

export default async (request: Request) => {
	// The request's own URL and Host are the proxy's, not the one the client
	// dialled, so each build says which host it dials (see vite.config.ts).
	const url = new URL(request.url)
	const host =
		url.searchParams.get("host") ??
		new URL(getContext().site.url ?? request.url).host
	if (request.headers.get("upgrade")?.toLowerCase() != "websocket") {
		return new Response(
			`subduction sync server\nservice: ${host}\npeer: ${signer.peerId()}\nupstream: ${UPSTREAM_URL}\n`,
			{headers: {"content-type": "text/plain; charset=utf-8"}}
		)
	}
	const {socket, response} = upgradeWebSocket(request, {idleTimeout: 30})
	const transport = new SocketTransport(socket)
	subduction.acceptTransport(transport, host).catch(error => {
		console.warn(`[subduction] couldn't accept a peer on ${host}:`, error)
		void transport.disconnect()
	})
	return response
}
