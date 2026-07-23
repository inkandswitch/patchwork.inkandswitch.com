import { defineConfig, type Plugin } from "vite";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const core = process.env.PATCHWORK_CORE_DIR
  ? resolve(process.env.PATCHWORK_CORE_DIR)
  : undefined;
const patchworkModule = core
  ? pathToFileURL(
      join(core, "core", "patchwork", "dist", "vite", "patchwork-plugin.js"),
    ).href
  : "@inkandswitch/patchwork/vite";
const { default: patchwork } = await import(patchworkModule);

function revision(directory: string) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function packageDirectory(name: string) {
  try {
    return dirname(fileURLToPath(import.meta.resolve(`${name}/package.json`)));
  } catch {
    // packages with an "exports" map don't necessarily expose their manifest
    let directory = dirname(fileURLToPath(import.meta.resolve(name)));
    while (dirname(directory) !== directory) {
      const manifest = join(directory, "package.json");
      if (
        existsSync(manifest) &&
        JSON.parse(readFileSync(manifest, "utf8")).name === name
      ) {
        return directory;
      }
      directory = dirname(directory);
    }
    throw new Error(`Could not find ${name}/package.json`);
  }
}

function coreSource() {
  if (!core) {
    const manifest = join(
      packageDirectory("@inkandswitch/patchwork"),
      "package.json",
    );
    return {
      name: "@inkandswitch/patchwork",
      version: JSON.parse(readFileSync(manifest, "utf8")).version,
    };
  }
  return { name: "checkout", revision: revision(core) };
}

function baseSource(): {
  directory: string;
  name: string;
  version?: string;
  revision?: string;
} {
  if (process.env.PATCHWORK_BASE_DIR) {
    const checkout = resolve(process.env.PATCHWORK_BASE_DIR);
    const directory = join(checkout);
    if (!existsSync(join(directory, "modules.json"))) {
      throw new Error(`No built base bundle at ${directory}`);
    }
    return { directory, name: "checkout", revision: revision(checkout) };
  }
  const name = "@inkandswitch/patchwork-pkg-base";
  const packageRoot = packageDirectory(name);
  const staticDist = join(packageRoot, "static-dist");
  return {
    directory: existsSync(staticDist) ? staticDist : packageRoot,
    name,
    version: JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ).version,
  };
}

const IGNORED = new Set(["_headers", ".watch-ready"]);
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

async function baseFiles(source: string, directory = source): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await baseFiles(source, path)));
    if (entry.isFile() && !IGNORED.has(entry.name)) {
      files.push(relative(source, path));
    }
  }
  return files;
}

async function copyBase(
  source: string,
  outDir: string,
  previous: Set<string>,
): Promise<Set<string>> {
  const touched = new Set(previous);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const files = await baseFiles(source);
      for (const path of files) {
        touched.add(path);
        const to = join(outDir, path);
        await mkdir(dirname(to), { recursive: true });
        await copyFile(join(source, path), to);
      }
      const present = new Set(files);
      for (const path of touched) {
        if (!present.has(path)) await rm(join(outDir, path), { force: true });
      }
      return present;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" ||
        attempt === 4
      ) {
        throw error;
      }
    }
  }
  return previous;
}

/**
 * Copies the base tools bundle (modules.json + packages/) alongside the built
 * shell, and records what everything was built from. With PATCHWORK_BASE_DIR
 * set, base's own watcher touches .watch-ready after each rebuild — watching
 * that one file rebuilds the site and recopies the bundle.
 */
function environment(): Plugin {
  const base = baseSource();
  const site = join(root, "dist");
  const stylesheets = new Map([
    [
      "/@inkandswitch/patchwork/global.css",
      core
        ? join(core, "core", "patchwork", "dist", "global.css")
        : join(packageDirectory("@inkandswitch/patchwork"), "dist", "global.css"),
    ],
    [
      "/@inkandswitch/patchwork-bootloader/global.css",
      core
        ? join(core, "core", "bootloader", "dist", "global.css")
        : join(
            packageDirectory("@inkandswitch/patchwork"),
            "..",
            "patchwork-bootloader",
            "dist",
            "global.css",
          ),
    ],
  ]);
  let outDir: string;
  let serve = false;
  let copied = new Set<string>();
  return {
    name: "patchwork-environment",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      serve = config.command === "serve";
    },
    transformIndexHtml(html) {
      if (!serve) return html;
      return html.replace(
        'href="@inkandswitch/patchwork/global.css"',
        'href="/@inkandswitch/patchwork/global.css"',
      );
    },
    buildStart() {
      if (process.env.PATCHWORK_BASE_DIR) {
        this.addWatchFile(join(base.directory, ".watch-ready"));
      }
    },
    async closeBundle() {
      copied = await copyBase(base.directory, outDir, copied);

      await writeFile(
        join(outDir, "build-info.json"),
        `${JSON.stringify(
          {
            site: { revision: revision(root) },
            core: coreSource(),
            base: {
              name: base.name,
              version: base.version,
              revision: base.revision,
            },
            packageListURL: process.env.PATCHWORK_SYSTEM_PACKAGE_LIST_URL,
          },
          null,
          2,
        )}\n`,
      );
    },
    configureServer(server) {
      const ready = join(base.directory, ".watch-ready");
      server.watcher.add(ready);
      server.watcher.on("change", (path) => {
        if (path === ready) server.ws.send({ type: "full-reload" });
      });
      server.middlewares.use(async (request, response, next) => {
        try {
          const pathname = decodeURIComponent(
            new URL(request.url ?? "/", "http://localhost").pathname,
          );
          const stylesheet = stylesheets.get(pathname);
          if (stylesheet) {
            response.setHeader("Cache-Control", "no-cache");
            response.setHeader("Content-Type", "text/css");
            const css = await readFile(stylesheet, "utf8");
            response.end(
              pathname === "/@inkandswitch/patchwork/global.css"
                ? css.replace(
                    '"@inkandswitch/patchwork-bootloader/global.css"',
                    '"/@inkandswitch/patchwork-bootloader/global.css"',
                  )
                : css,
            );
            return;
          }
          for (const directory of [base.directory, site]) {
            const path = resolve(directory, `.${pathname}`);
            const fromDirectory = relative(directory, path);
            if (
              fromDirectory === ".." ||
              fromDirectory.startsWith(`..${sep}`)
            ) {
              continue;
            }
            try {
              if (!(await stat(path)).isFile()) continue;
            } catch {
              continue;
            }
            response.setHeader("Cache-Control", "no-cache");
            response.setHeader(
              "Content-Type",
              CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
            );
            response.end(await readFile(path));
            return;
          }
          next();
        } catch {
          next();
        }
      });
    },
  };
}

export default defineConfig(({ command }) => {
  const plugins = patchwork({
    siteName: "patchwork.inkandswitch.com",
    title: "Patchwork",
    description: "local-first collaborative malleable software environment",
    server: core ? { fs: { allow: [root, core] } } : undefined,
    syncServers:
      process.env.KEYHIVE === "true"
        ? {
            keyhive:
              process.env.KEYHIVE_SYNC_SERVER === "true"
                ? "keyhive"
                : "subduction",
          }
        : undefined,
    themeColor: { light: "#f8f8f8", dark: "#181e24" },
    icons: {
      source: process.env.PATCHWORK_FAVICON ?? "public/patchwork.svg",
      maskIcon: "public/mask.svg",
    },
  });
  if (command === "serve") {
    const importmap = plugins.find((plugin) => plugin.name === "@patchwork/vite");
    if (importmap) delete importmap.buildStart;
  }
  return {
    envPrefix: ["VITE_", "PATCHWORK_"],
    optimizeDeps: {
      exclude: ["@automerge/automerge-repo-storage-indexeddb"],
    },
    publicDir: command === "serve" ? false : "public",
    resolve: {
      alias: [
        ...(core
          ? [
              {
                find: /^@inkandswitch\/patchwork$/,
                replacement: join(
                  core,
                  "core",
                  "patchwork",
                  "dist",
                  "index.js",
                ),
              },
              {
                find: /^@inkandswitch\/patchwork\/global\.css$/,
                replacement: join(
                  core,
                  "core",
                  "patchwork",
                  "dist",
                  "global.css",
                ),
              },
            ]
          : []),
      ],
    },
    plugins: [
      ...plugins.filter(
        (plugin) =>
          command !== "serve" || plugin.name !== "@patchwork/service-worker",
      ),
      environment(),
    ],
  };
});
