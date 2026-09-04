import { defineConfig } from "tsup"

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  // The package tsconfig is `composite`, which the .d.ts bundler cannot use.
  dts: { compilerOptions: { composite: false, incremental: false, declarationMap: false } },
  sourcemap: true,
  treeshake: true,
  clean: true,
  target: "es2022",
  // The wasm-pack glue and the `.wasm` file next to it are shipped as-is in
  // `pkg/`. Keeping the glue external means `dist/index.js` still imports
  // `../pkg/mocanvas.js`, so both the glue's own asset resolution and ours
  // point at the real `pkg/mocanvas_bg.wasm`.
  external: ["../pkg/mocanvas.js"],
})
