import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const children = [];
const processGroups = process.platform !== "win32";
let stopping = false;

function checkout(variable, names) {
  if (process.env[variable]) return resolve(process.env[variable]);
  return names
    .map((name) => resolve(root, "..", name))
    .find((directory) => existsSync(join(directory, "package.json")));
}

function run(name, command, args, cwd, env = process.env) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
    detached: processGroups,
  });
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

function ensure(path, command, args, cwd, env = process.env) {
  if (existsSync(path)) return;
  build(command, args, cwd, env);
}

function build(command, args, cwd, env = process.env) {
  const child = spawnSync(command, args, { cwd, env, stdio: "inherit" });
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
  for (const child of children) {
    if (child.exitCode !== null || child.killed) continue;
    try {
      if (processGroups && child.pid) process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
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
const watchEnv = {
  ...env,
  PNPM_CONFIG_REPORTER: process.env.PNPM_CONFIG_REPORTER ?? "append-only",
};

if (core) {
  ensure(
    join(core, "core", "patchwork", "dist", "vite", "patchwork-plugin.js"),
    "pnpm",
    ["--filter", "@inkandswitch/patchwork...", "build"],
    core,
  );
}

if (base) {
  ensureBase(base);
}

build("pnpm", ["exec", "vite", "build"], root, env);
if (core) run("core", "pnpm", ["watch"], core, watchEnv);
if (base) run("base", "pnpm", ["watch"], base, watchEnv);
run("site", "pnpm", ["exec", "vite"], root, watchEnv);
