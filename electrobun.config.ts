import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Aproxy",
    identifier: "dev.aproxy.app",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "src/electrobun/index.ts",
    },
    copy: {
      "ui/dist/index.html": "views/mainview/index.html",
      "ui/dist/assets": "views/mainview/assets",
      "examples/scenarios": "examples/scenarios",
      "examples/views": "examples/views",
      "src/ruleSandboxWorker.ts": "bun/ruleSandboxWorker.ts",
    },
    // Ignore Vite output in watch mode — HMR handles view rebuilds separately
    watchIgnore: ["ui/dist/**"],
    mac: {
      bundleCEF: false,
      icons: "icon.iconset",
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
  scripts: {
    preBuild: "./scripts/build-ui.ts",
  },
} satisfies ElectrobunConfig;
