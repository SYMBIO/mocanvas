import { configDefaults, defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // `.tsbuild` holds the `tsc -b` output, which duplicates every test file.
    exclude: [...configDefaults.exclude, "**/.tsbuild/**"],
  },
})
