import { defineConfig, type Options } from "tsup"

/** An esbuild plugin, spelled through tsup so `esbuild` need not be a dependency. */
type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number]

const STUB = "mocanvas-css-stub"

/**
 * Keep the stylesheet out of the JavaScript bundle.
 *
 * `src/ui/*.tsx` imports `./ui.css` so that the app under `apps/playground`
 * and anyone consuming the workspace source gets the default theme for free.
 * That import must not survive into `dist/index.js`: Node has no loader for
 * `.css`, so any consumer who imports this package outside a bundler — vitest,
 * an SSR render, a plain `node --input-type=module` script — gets
 * `ERR_UNKNOWN_FILE_EXTENSION`. A bundler tolerates it; Node does not, and a
 * library entry point has to load in both.
 *
 * So the CSS is dropped from the JS graph here and emitted as its own entry
 * (`dist/mocanvas.css`) instead, which the consumer imports explicitly —
 * the same arrangement every React library that ships a stylesheet uses
 * (`@mantine/core/styles.css`, `@blocknote/react/style.css`, `tldraw/tldraw.css`).
 */
const cssOutOfJs: EsbuildPlugin = {
  name: "mocanvas-css-out-of-js",
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, (args) => {
      // The stylesheet's own entry point still has to be built as CSS.
      if (args.kind === "entry-point") return null
      // The stub path deliberately does not end in `.css`: tsup's own postcss
      // loader matches on that extension and would claim the module back.
      return { path: STUB, namespace: STUB }
    })
    build.onLoad({ filter: new RegExp(`^${STUB}$`), namespace: STUB }, () => ({
      contents: "",
      loader: "js",
    }))
  },
}

export default defineConfig({
  entry: {
    index: "src/index.ts",
    // Published as `@mocanvas/mocanvas/mocanvas.css`. The name is fixed on
    // purpose: the previous build hashed it (`ui-4C5V5GYT.css`), so no consumer
    // could write a stable import for it.
    mocanvas: "src/ui/ui.css",
  },
  format: ["esm"],
  // The package tsconfig is `composite`, which the .d.ts bundler cannot use.
  dts: {
    entry: { index: "src/index.ts" },
    compilerOptions: { composite: false, incremental: false, declarationMap: false },
  },
  sourcemap: true,
  treeshake: true,
  clean: true,
  target: "es2022",
  esbuildPlugins: [cssOutOfJs],
  external: ["@mocanvas/editor", "@mocanvas/state", "@mocanvas/state/react", "@mocanvas/store", "@mocanvas/wasm", "react", "react-dom", "react/jsx-runtime"],
})
