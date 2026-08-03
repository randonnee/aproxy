import type { ElectrobunConfig } from "electrobun";

// Signing is opt-in via the environment rather than hardcoded, so a local
// `bun run desktop:build` produces a working (unsigned) app instead of aborting
// with "Env var ELECTROBUN_DEVELOPER_ID is required to codesign". CI supplies
// these from repository secrets and gets a signed, notarized build unchanged.
//
// Notarization additionally requires codesigning — electrobun computes
// `shouldNotarize = shouldCodesign && config.build.mac.notarize` — so partial
// credentials degrade to signed-but-not-notarized instead of failing.
const codesign = Boolean(process.env.ELECTROBUN_DEVELOPER_ID);
const notarize =
  codesign &&
  Boolean(
    process.env.ELECTROBUN_APPLEID &&
      process.env.ELECTROBUN_APPLEIDPASS &&
      process.env.ELECTROBUN_TEAMID
  );

if (!codesign) {
  console.warn(
    "[electrobun] ELECTROBUN_DEVELOPER_ID not set — building unsigned. " +
      "Gatekeeper will quarantine the result; clear it with `xattr -cr /Applications/Aproxy.app`."
  );
} else if (!notarize) {
  console.warn(
    "[electrobun] Signing without notarization — set ELECTROBUN_APPLEID, " +
      "ELECTROBUN_APPLEIDPASS and ELECTROBUN_TEAMID to notarize."
  );
}

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
      "python/aproxy_addon.py": "python/aproxy_addon.py",
    },
    // Ignore Vite output in watch mode — HMR handles view rebuilds separately
    watchIgnore: ["ui/dist/**"],
    mac: {
      bundleCEF: false,
      icons: "icon.iconset",
      codesign,
      notarize,
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
