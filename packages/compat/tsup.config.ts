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
  external: ["mocanvas", "@mocanvas/editor", "@mocanvas/state", "@mocanvas/store", "react", "react/jsx-runtime"],
})
