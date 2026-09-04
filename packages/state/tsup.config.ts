import { defineConfig } from "tsup"

export default defineConfig({
  entry: { index: "src/index.ts", react: "src/react.ts" },
  format: ["esm"],
  // The package tsconfig is `composite`, which the .d.ts bundler cannot use.
  dts: { compilerOptions: { composite: false, incremental: false, declarationMap: false } },
  sourcemap: true,
  treeshake: true,
  clean: true,
  target: "es2022",
  // React is only needed by the `@mocanvas/state/react` entry.
  external: ["react", "react/jsx-runtime"],
})
