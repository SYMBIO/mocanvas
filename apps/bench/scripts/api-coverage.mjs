/**
 * How much of tldraw's public API surface mocanvas exports, counted rather than
 * estimated.
 *
 * ## Why it lives here
 *
 * `apps/bench` is the one place the clean-room policy lets us look at tldraw's
 * *declaration* files (docs/CLEAN_ROOM.md, "The one exception"). This reads only
 * `.d.ts` — never a `.js`, `.mjs` or anything under `src/` — and only to count
 * names. Nothing it prints is copied into the library.
 *
 * ## What it counts
 *
 * The denominator is every symbol each tldraw SDK package exports. That is a
 * harder target than "documented symbols on the reference site": the reference
 * omits some exports, so measuring against the declarations can only understate
 * coverage, never flatter it.
 *
 * The numerator is name-level: a tldraw symbol counts as covered when *any*
 * published mocanvas package exports that name. Any, rather than the one package
 * COMPAT.md maps it to, because `tldraw` is an umbrella that re-exports
 * `@tldraw/store` and `@tldraw/state` wholesale — scoring it against
 * `@mocanvas/mocanvas` alone reports `Store` and `Atom` as missing while their
 * own rows say 100%. Name-level means this measures *reach*, not depth — a class that
 * exists with half its methods still counts. `--members` adds the depth check for
 * the classes and interfaces both sides share.
 *
 * ## The two denominators
 *
 * `--reference` measures against the symbols tldraw.dev/reference actually
 * documents, enumerated in `fixtures/tldraw-reference.txt`. That is the
 * compatibility promise COMPAT.md makes, and the number to quote.
 *
 * The default measures against every symbol the packages *export*, which is a
 * larger set: it includes `@tldraw/utils` helpers the umbrella re-exports but the
 * reference does not list. Useful as a stricter check — code that imported one of
 * those from `tldraw` still breaks — but it is not the documented surface.
 *
 * Usage, from the repo root, after `pnpm build`:
 *   node apps/bench/scripts/api-coverage.mjs [--reference] [--members] [--list]
 */
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import ts from "typescript"

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

/**
 * The mapping docs/COMPAT.md publishes, as data.
 *
 * `@tldraw/utils` and `@tldraw/driver` are absent on purpose: COMPAT.md excludes
 * driver as a separate library, and utils is a grab-bag the public API does not
 * ask a consumer to import.
 */
const PACKAGES = [
  { from: "tldraw", to: ["@mocanvas/mocanvas"] },
  { from: "@tldraw/editor", to: ["@mocanvas/editor"] },
  { from: "@tldraw/store", to: ["@mocanvas/store"] },
  { from: "@tldraw/state", to: ["@mocanvas/state"] },
  { from: "@tldraw/state-react", to: ["@mocanvas/state"] },
  { from: "@tldraw/tlschema", to: ["@mocanvas/editor"] },
  { from: "@tldraw/validate", to: ["@mocanvas/editor"] },
]

/** Every mocanvas symbol is also reachable here; see the mapping table. */
const COMPAT = "@mocanvas/compat"

/**
 * Where each `@tldraw/*` package's declarations actually sit.
 *
 * Resolved by walking pnpm's store rather than by `require.resolve`, because the
 * scoped packages are transitive dependencies of `tldraw` and are not reachable
 * from the bench's own `node_modules`. The map is also handed to the compiler as
 * `paths`, so a `export * from "@tldraw/editor"` inside a declaration file
 * resolves — without it the umbrella looks about 400 symbols smaller than it is,
 * silently, because `skipLibCheck` swallows the unresolved-module error.
 */
function tldrawPaths() {
  const roots = [path.join(ROOT, "node_modules/.pnpm"), path.join(ROOT, "apps/bench/node_modules/tldraw/node_modules")]
  const out = {}
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const dir of fs.readdirSync(root)) {
      const base = root.endsWith(".pnpm") ? path.join(root, dir, "node_modules/@tldraw") : path.join(root, "@tldraw")
      if (!fs.existsSync(base)) continue
      for (const name of fs.readdirSync(base)) {
        const entry = path.join(base, name, "dist-cjs/index.d.ts")
        if (fs.existsSync(entry) && !out[`@tldraw/${name}`]) out[`@tldraw/${name}`] = entry
      }
      if (!root.endsWith(".pnpm")) break
    }
  }
  return out
}

const TLDRAW_DTS = tldrawPaths()

/** The declaration entry point of an installed package, or null. */
function declarationEntry(name) {
  if (TLDRAW_DTS[name]) return TLDRAW_DTS[name]
  // A workspace package: read it straight from its folder, so this works whether
  // or not the bench happens to depend on it.
  if (name.startsWith("@mocanvas/")) {
    const dir = path.join(ROOT, "packages", name.slice("@mocanvas/".length))
    const built = path.join(dir, "dist/index.d.ts")
    if (fs.existsSync(built)) return built
    return null
  }
  let pkgJson
  try {
    pkgJson = require.resolve(`${name}/package.json`, { paths: [path.join(ROOT, "apps/bench"), ROOT] })
  } catch {
    // `exports` may hide package.json; fall back to walking node_modules.
    const guess = [
      path.join(ROOT, "apps/bench/node_modules", name, "package.json"),
      path.join(ROOT, "node_modules", name, "package.json"),
    ].find((p) => fs.existsSync(p))
    if (!guess) return null
    pkgJson = guess
  }
  const dir = path.dirname(pkgJson)
  const d = JSON.parse(fs.readFileSync(pkgJson, "utf8"))
  const candidates = [
    d.types,
    d.typings,
    typeof d.exports?.["."] === "string" ? null : d.exports?.["."]?.types,
    typeof d.exports?.["."] === "string" ? null : d.exports?.["."]?.import?.types,
    "dist-cjs/index.d.ts",
    "dist/index.d.ts",
    "dist-esm/index.d.mts",
  ].filter(Boolean)
  for (const c of candidates) {
    const p = path.resolve(dir, c)
    if (fs.existsSync(p) && /\.d\.[cm]?ts$/.test(p)) return p
  }
  return null
}

/** Exported symbol names of a declaration file, with the checker following re-exports. */
function exportsOf(entry) {
  const paths = {}
  for (const [name, file] of Object.entries(TLDRAW_DTS)) paths[name] = [file]
  for (const dir of fs.readdirSync(path.join(ROOT, "packages"))) {
    const built = path.join(ROOT, "packages", dir, "dist/index.d.ts")
    if (fs.existsSync(built)) paths[`@mocanvas/${dir}`] = [built]
  }
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noResolve: false,
    baseUrl: ROOT,
    paths,
  })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(entry)
  if (!source) return { names: new Set(), symbols: new Map() }
  const moduleSymbol = checker.getSymbolAtLocation(source)
  if (!moduleSymbol) return { names: new Set(), symbols: new Map() }
  const names = new Set()
  const symbols = new Map()
  for (const s of checker.getExportsOfModule(moduleSymbol)) {
    names.add(s.getName())
    symbols.set(s.getName(), { symbol: s, checker })
  }
  return { names, symbols }
}

/** Public member names of a class/interface symbol, minus private and internal ones. */
function membersOf(entry) {
  if (!entry) return new Set()
  const { symbol, checker } = entry
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  const out = new Set()
  const declared = checker.getDeclaredTypeOfSymbol(resolved)
  for (const p of checker.getPropertiesOfType(declared)) {
    const n = p.getName()
    if (!n.startsWith("_") && !n.startsWith("#")) out.add(n)
  }
  // Statics and the constructor live on the symbol's own type, not the instance's.
  const own = checker.getTypeOfSymbolAtLocation(resolved, resolved.valueDeclaration ?? resolved.declarations?.[0])
  if (own) {
    for (const p of checker.getPropertiesOfType(own)) {
      const n = p.getName()
      if (!n.startsWith("_") && !n.startsWith("#") && n !== "prototype") out.add(n)
    }
  }
  return out
}

const wantMembers = process.argv.includes("--members")
const wantList = process.argv.includes("--list")
const wantReference = process.argv.includes("--reference")

/**
 * Packages the reference documents that mocanvas does not implement, and which
 * the in-scope figure therefore leaves out. They are not one category — sync is
 * a different multiplayer architecture, mermaid and driver are simply not built
 * yet — so COMPAT.md's *Not implemented* section is what explains them.
 */
const NOT_IMPLEMENTED_PACKAGES = new Set(["driver", "mermaid", "sync", "sync-core"])

/** `package/Symbol` lines from the reference enumeration, grouped by package. */
function referenceSymbols() {
  const file = path.join(ROOT, "apps/bench/fixtures/tldraw-reference.txt")
  const byPackage = new Map()
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const l = line.trim()
    if (!l || l.startsWith("#")) continue
    const slash = l.indexOf("/")
    if (slash < 0) continue
    const pkg = l.slice(0, slash)
    if (!byPackage.has(pkg)) byPackage.set(pkg, new Set())
    byPackage.get(pkg).add(l.slice(slash + 1))
  }
  return byPackage
}

const compatEntry = declarationEntry(COMPAT)
if (!compatEntry) {
  console.error(`cannot find ${COMPAT} declarations — run \`pnpm build\` first`)
  process.exit(1)
}
const compat = exportsOf(compatEntry)

/** Every name any published mocanvas package exports. */
const ours = { names: new Set(compat.names), symbols: new Map(compat.symbols) }
for (const dir of fs.readdirSync(path.join(ROOT, "packages"))) {
  const built = path.join(ROOT, "packages", dir, "dist/index.d.ts")
  if (!fs.existsSync(built)) continue
  const e = exportsOf(built)
  for (const n of e.names) ours.names.add(n)
  for (const [k, v] of e.symbols) if (!ours.symbols.has(k)) ours.symbols.set(k, v)
}
console.log(`mocanvas exports ${ours.names.size} distinct names across its published packages.`)

if (wantReference) {
  const byPackage = referenceSymbols()
  let inTotal = 0
  let inCovered = 0
  const missing = []
  console.log("\nSymbols documented at tldraw.dev/reference, and how many mocanvas exports under the same name.\n")
  console.log("| package | documented | covered | missing | coverage |")
  console.log("| :--- | ---: | ---: | ---: | ---: |")
  for (const [pkg, syms] of [...byPackage].sort((a, b) => b[1].size - a[1].size)) {
    const covered = [...syms].filter((n) => ours.names.has(n)).length
    const excluded = NOT_IMPLEMENTED_PACKAGES.has(pkg)
    console.log(`| \`${pkg}\`${excluded ? " *(not implemented)*" : ""} | ${syms.size} | ${covered} | ${syms.size - covered} | ${((covered / syms.size) * 100).toFixed(1)}% |`)
    if (excluded) continue
    inTotal += syms.size
    inCovered += covered
    for (const n of syms) if (!ours.names.has(n)) missing.push(`${pkg}/${n}`)
  }
  console.log(`\n**In scope (the seven packages COMPAT.md maps): ${inCovered} of ${inTotal} — ${((inCovered / inTotal) * 100).toFixed(1)}%.**`)
  if (missing.length) console.log(`\nMissing:\n\n${missing.sort().join("\n")}`)
  process.exit(missing.length === 0 ? 0 : 1)
}

let totalDocumented = 0
let totalCovered = 0
const rows = []
const missingByPackage = new Map()

for (const { from, to } of PACKAGES) {
  const theirs = declarationEntry(from)
  if (!theirs) {
    console.error(`skipping ${from}: no declarations installed`)
    continue
  }
  const theirExports = exportsOf(theirs)
  const ourNames = ours.names
  const ourSymbols = ours.symbols
  void to

  const missing = []
  let covered = 0
  for (const name of theirExports.names) {
    if (ourNames.has(name)) covered++
    else missing.push(name)
  }
  totalDocumented += theirExports.names.size
  totalCovered += covered
  missing.sort()
  missingByPackage.set(from, missing)
  rows.push({ from, total: theirExports.names.size, covered, missing: missing.length })

  if (wantMembers) {
    let memberTotal = 0
    let memberCovered = 0
    const thin = []
    for (const name of theirExports.names) {
      if (!ourNames.has(name)) continue
      const theirM = membersOf(theirExports.symbols.get(name))
      if (theirM.size === 0) continue
      const ourM = membersOf(ourSymbols.get(name))
      const hit = [...theirM].filter((m) => ourM.has(m)).length
      memberTotal += theirM.size
      memberCovered += hit
      if (hit < theirM.size) thin.push({ name, hit, of: theirM.size, missing: [...theirM].filter((m) => !ourM.has(m)) })
    }
    rows[rows.length - 1].memberTotal = memberTotal
    rows[rows.length - 1].memberCovered = memberCovered
    rows[rows.length - 1].thin = thin.sort((a, b) => a.of - b.of - (a.hit - b.hit))
  }
}

const pct = (a, b) => (b === 0 ? "—" : `${((a / b) * 100).toFixed(1)}%`)

console.log("\nSymbols exported by each tldraw SDK package, and how many mocanvas exports under the same name.\n")
console.log("| package | symbols | covered | missing | coverage |")
console.log("| :--- | ---: | ---: | ---: | ---: |")
for (const r of rows) console.log(`| \`${r.from}\` | ${r.total} | ${r.covered} | ${r.missing} | ${pct(r.covered, r.total)} |`)
console.log(`| **total (with duplicates across packages)** | **${totalDocumented}** | **${totalCovered}** | **${totalDocumented - totalCovered}** | **${pct(totalCovered, totalDocumented)}** |`)

// The umbrella re-exports the scoped packages, so the sum above counts many
// symbols more than once. The union is the honest headline.
const unionTheirs = new Set()
const unionMissing = new Set()
for (const { from } of PACKAGES) {
  const e = declarationEntry(from)
  if (!e) continue
  for (const n of exportsOf(e).names) unionTheirs.add(n)
}
for (const [, list] of missingByPackage) for (const n of list) unionMissing.add(n)
for (const n of unionMissing) if (!unionTheirs.has(n)) unionMissing.delete(n)
const unionCovered = unionTheirs.size - unionMissing.size
console.log(`\n**Distinct symbols across all seven packages: ${unionTheirs.size}. Covered: ${unionCovered} (${pct(unionCovered, unionTheirs.size)}). Missing: ${unionMissing.size}.**`)

// A `TL*` name whose unprefixed form we export is not a missing capability, it
// is a missing alias in @mocanvas/compat — which is the package whose whole job
// is carrying those spellings. Worth separating: the two cost very different
// amounts to close.
const aliasGap = []
const realGap = []
for (const n of unionMissing) {
  const bare = n.startsWith("TL") ? n.slice(2) : null
  if (bare && ours.names.has(bare)) aliasGap.push(`${n} (have ${bare})`)
  else realGap.push(n)
}
aliasGap.sort()
realGap.sort()
console.log(`\nOf those ${unionMissing.size}: ${aliasGap.length} are \`TL*\` spellings whose unprefixed type mocanvas already exports — a missing alias in @mocanvas/compat, not a missing feature. ${realGap.length} are genuinely absent.`)
console.log(`With the aliases counted, reach is ${pct(unionCovered + aliasGap.length, unionTheirs.size)}.`)
if (wantList) {
  console.log(`\n### Missing only as a \`TL*\` alias (${aliasGap.length})\n\n${aliasGap.join(", ")}\n`)
  console.log(`### Genuinely absent (${realGap.length})\n\n${realGap.join(", ")}\n`)
}

if (wantMembers) {
  console.log("\n| package | members of shared symbols | present | coverage |")
  console.log("| :--- | ---: | ---: | ---: |")
  for (const r of rows) {
    if (r.memberTotal === undefined) continue
    console.log(`| \`${r.from}\` | ${r.memberTotal} | ${r.memberCovered} | ${pct(r.memberCovered, r.memberTotal)} |`)
  }
}

if (wantList) {
  console.log("\n## Missing, by package\n")
  for (const [pkg, list] of missingByPackage) {
    if (list.length === 0) continue
    console.log(`### ${pkg} (${list.length})\n`)
    console.log(list.join(", "))
    console.log()
  }
  if (wantMembers) {
    console.log("## Shared symbols with missing members\n")
    for (const r of rows) {
      for (const t of r.thin ?? []) {
        console.log(`- \`${t.name}\` ${t.hit}/${t.of} — missing: ${t.missing.slice(0, 12).join(", ")}${t.missing.length > 12 ? ` … +${t.missing.length - 12}` : ""}`)
      }
    }
  }
}
