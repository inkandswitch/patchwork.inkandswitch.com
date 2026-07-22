import { defineConfig } from "vite";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const core = process.env.PATCHWORK_CORE_DIR
  ? resolve(process.env.PATCHWORK_CORE_DIR)
  : undefined;
const patchworkModule = core
  ? pathToFileURL(
      join(core, "core", "patchwork", "dist", "vite", "patchwork-plugin.js"),
    ).href
  : "@inkandswitch/patchwork/vite";
const { default: patchwork } = await import(patchworkModule);

export default defineConfig({
  resolve: core
    ? {
        alias: [
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
        ],
      }
    : undefined,
  plugins: [
    patchwork({
      siteName: "patchwork.inkandswitch.com",
      title: "Patchwork",
      description: "local-first collaborative malleable software environment",
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
        source:
          process.env.PATCHWORK_PREVIEW === "true"
            ? "public/patchwork-preview.svg"
            : "public/patchwork.svg",
        maskIcon: "public/mask.svg",
      },
    }),
  ],
});
