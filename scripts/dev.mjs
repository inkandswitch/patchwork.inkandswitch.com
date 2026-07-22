import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const children = [];
let stopping = false;

function checkout(variable, names) {
  if (process.env[variable]) return resolve(process.env[variable]);
  return names
    .map((name) => resolve(root, "..", name))
    .find((directory) => existsSync(join(directory, "package.json")));
}

function run(name, command, args, cwd, env = process.env) {
  const child = spawn(command, args, { cwd, env, stdio: "inherit" });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (stopping) return;
    process.exitCode = code ?? (signal ? 1 : 0);
    stop();
  });
  child.on("error", (error) => {
    console.error(`${name}: ${error.message}`);
    process.exitCode = 1;
    stop();
  });
}

function ensure(path, command, args, cwd) {
  if (existsSync(path)) return;
  const child = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (child.status !== 0) process.exit(child.status ?? 1);
}

function ensureBase(directory) {
  if (existsSync(join(directory, "static-dist", "modules.json"))) return;
  for (const [command, args] of [
    ["pnpm", ["-r", "--if-present", "build"]],
    ["node", ["scripts/bundle.mjs"]],
  ]) {
    const child = spawnSync(command, args, {
      cwd: directory,
      stdio: "inherit",
    });
    if (child.status !== 0) process.exit(child.status ?? 1);
  }
}

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  if (!children.some((child) => child.exitCode === null)) process.exit();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const core = checkout("PATCHWORK_CORE_DIR", ["core", "patchwork-next"]);
const base = checkout("PATCHWORK_BASE_DIR", ["base", "patchwork-base"]);
const env = {
  ...process.env,
  ...(core ? { PATCHWORK_CORE_DIR: core } : {}),
  ...(base ? { PATCHWORK_BASE_DIR: base } : {}),
};

if (core) {
  ensure(
    join(core, "core", "patchwork", "dist", "vite", "patchwork-plugin.js"),
    "pnpm",
    ["--filter", "@inkandswitch/patchwork...", "build"],
    core,
  );
  run("core", "pnpm", ["watch"], core);
}

if (base) {
  ensureBase(base);
  run("base", "pnpm", ["watch"], base);
}
run("site", "node", ["scripts/build.mjs", "--watch"], root, env);
run("preview", "pnpm", ["exec", "vite", "preview"], root, env);
