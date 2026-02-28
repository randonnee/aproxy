import { existsSync, readFileSync, writeFileSync } from "node:fs";

const targetPath =
  "node_modules/electrobun/dist/api/bun/proc/native.ts";

if (!existsSync(targetPath)) {
  console.log(`Electrobun patch: ${targetPath} not found, skipping.`);
  process.exit(0);
}

const source = readFileSync(targetPath, "utf8");

if (
  source.includes("new TextEncoder().encode(menuConfig + \\\"\\0\\\")") ||
  source.includes("Bun.sleepSync(150)")
) {
  console.log("Electrobun patch: setApplicationMenu already patched.");
  process.exit(0);
}

const matcher =
  /setApplicationMenu: \(params: \{ menuConfig: string \}\): void => \{[\s\S]*?\},/;

if (!matcher.test(source)) {
  console.log("Electrobun patch: setApplicationMenu block not found.");
  process.exit(0);
}

const replacement = `setApplicationMenu: (params: { menuConfig: string }): void => {
    const { menuConfig } = params;

    const encoded = new TextEncoder().encode(menuConfig + "\\0");
    const ab = new ArrayBuffer(encoded.length);
    const stable = new Uint8Array(ab);
    stable.set(encoded);

    (globalThis as any).__electrobun_menuConfigBuf = stable;

    native.symbols.setApplicationMenu(
      // @ts-ignore - ptr is valid in Bun
      ptr(stable),
      applicationMenuHandler,
    );

    Bun.sleepSync(150);
  },`;

const updated = source.replace(matcher, replacement);
writeFileSync(targetPath, updated, "utf8");
console.log("Electrobun patch: setApplicationMenu updated.");
