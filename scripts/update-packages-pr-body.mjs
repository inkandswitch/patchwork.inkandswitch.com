import { readFile } from "node:fs/promises"

let input = ""
for await (const chunk of process.stdin) input += chunk

const packages = JSON.parse(input)[0]
const dependencies = {
	...packages.dependencies,
	...packages.devDependencies,
}
const previousPackage = process.argv[2]
	? JSON.parse(await readFile(process.argv[2], "utf8"))
	: {}
const previousDependencies = {
	...previousPackage.dependencies,
	...previousPackage.devDependencies,
}

const rows = await Promise.all(
	Object.entries(dependencies).map(async ([name, { version }]) => {
		const previousVersion = previousDependencies[name]?.match(
			/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/,
		)?.[0]
		const details = await packageDetails(name, version, previousVersion)
		const packageName = details ? `[${name}](${details})` : name
		return [packageName, version]
	}),
)

console.log(
	[
		"caw caw! we have updates",
		"",
		"| Package | Version |",
		"| --- | --- |",
		...rows.map((row) => `| ${row.join(" | ")} |`),
		"",
		"(squark! merging this PR updates the live [Patchwork](https://patchwork.inkandswitch.com) website.)",
		"caw!!",
	].join("\n"),
)

async function packageDetails(name, version, previousVersion) {
	const metadata = await fetchJson(
		`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`,
	)
	const repository = githubRepository(metadata?.repository)
	if (!repository) return

	const changelog = await findChangelog(repository)
	if (changelog) return changelog
	if (!previousVersion || previousVersion === version || !metadata.gitHead) return

	const previousMetadata = await fetchJson(
		`https://registry.npmjs.org/${encodeURIComponent(name)}/${previousVersion}`,
	)
	if (!previousMetadata?.gitHead) return

	return `https://github.com/${repository.owner}/${repository.name}/compare/${previousMetadata.gitHead}...${metadata.gitHead}`
}

async function findChangelog(repository) {
	const locations = [repository.directory, ""].filter(
		(location, index, locations) =>
			location !== undefined && locations.indexOf(location) === index,
	)

	for (const location of locations) {
		const entries = await fetchJson(
			`https://api.github.com/repos/${repository.owner}/${repository.name}/contents/${encodePath(location)}`,
			{
				Accept: "application/vnd.github+json",
				Authorization: process.env.GH_TOKEN
					? `Bearer ${process.env.GH_TOKEN}`
					: undefined,
				"X-GitHub-Api-Version": "2022-11-28",
			},
		)
		const changelog = Array.isArray(entries)
			? entries.find(
					(entry) =>
						entry.type === "file" &&
						entry.name.toLowerCase() === "changelog.md",
				)
			: undefined
		if (changelog) return changelog.html_url
	}
}

function githubRepository(repository) {
	if (!repository) return

	const value = typeof repository === "string" ? repository : repository.url
	const match = value?.match(
		/github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:#.*)?$/,
	)
	if (!match) return

	return {
		owner: match[1],
		name: match[2],
		directory:
			typeof repository === "object"
				? repository.directory?.replace(/^\/|\/$/g, "")
				: undefined,
	}
}

function encodePath(path) {
	return path
		.split("/")
		.filter(Boolean)
		.map(encodeURIComponent)
		.join("/")
}

async function fetchJson(url, headers) {
	try {
		const response = await fetch(url, {
			headers: Object.fromEntries(
				Object.entries(headers ?? {}).filter(([, value]) => value),
			),
		})
		if (!response.ok) return
		return response.json()
	} catch {}
}
