/**
 * Copy the guides a package needs into the package, so its npm tarball carries
 * them.
 *
 * The repository is private. A published README that links to it sends every
 * reader to a 404, and until there is a website there is nowhere else to point —
 * so the documentation has to travel inside the package instead of being
 * referenced from it.
 *
 * Run from a package directory, at `prepack`:
 *
 *   node ../../scripts/bundle-docs.mjs COMPAT.md MIGRATION.md
 *
 * The copies are build output: git ignores them, `files` ships them, and the
 * originals under `docs/` stay the only edited version.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const target = process.cwd()
const wanted = process.argv.slice(2)

if (wanted.length === 0) {
  console.error("bundle-docs: name at least one file from docs/")
  process.exit(1)
}

for (const name of wanted) {
  const from = path.join(ROOT, "docs", name)
  if (!fs.existsSync(from)) {
    // Fail loudly: a silently missing guide would publish a README that
    // promises a file the tarball does not have.
    console.error(`bundle-docs: docs/${name} does not exist`)
    process.exit(1)
  }
  fs.copyFileSync(from, path.join(target, name))
}

console.log(`bundle-docs: copied ${wanted.join(", ")} into ${path.basename(target)}`)
