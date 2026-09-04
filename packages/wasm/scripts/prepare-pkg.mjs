/**
 * Tidy up the wasm-pack output so it can be published as part of this package.
 *
 * wasm-pack writes a `.gitignore` containing `*` and a stand-alone
 * `package.json` into its out dir. npm applies a directory's `.gitignore` even
 * to files the `files` allow-list names, so leaving it there ships an empty
 * `pkg/`; the nested `package.json` would make `pkg/` look like a separate
 * package to bundlers. Neither is wanted — `pkg/` is plain data here.
 */
import { rmSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..", "pkg")

for (const name of [".gitignore", "package.json", "README.md"]) {
  rmSync(join(pkgDir, name), { force: true })
}

for (const required of ["mocanvas.js", "mocanvas.d.ts", "mocanvas_bg.wasm"]) {
  if (!existsSync(join(pkgDir, required))) {
    console.error(`packages/wasm: pkg/${required} is missing — run \`pnpm --filter @mocanvas/wasm build\`.`)
    process.exit(1)
  }
}
