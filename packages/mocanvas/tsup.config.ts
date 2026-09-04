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
  // `copy` keeps the `import "./ui.css"` in the output and copies the file
  // next to it, so a consumer's bundler picks the stylesheet up on its own —
  // exactly as it does from source today.
  loader: { ".css": "copy" },
  external: ["@mocanvas/editor", "@mocanvas/state", "@mocanvas/state/react", "@mocanvas/store", "@mocanvas/wasm", "react", "react-dom", "react/jsx-runtime"],
})
