#!/usr/bin/env node
/**
 * Compatibility parity check: type-check a consumer application against mocanvas
 * with `tldraw` remapped onto `@mocanvas/compat`, and report what still breaks.
 *
 * This is the acceptance metric for the tldraw-5 API migration: the number of
 * diagnostics trends to zero as the surface is completed.
 *
 *   node scripts/compat-parity.mjs --consumer ~/Sites/symbio/molekula-app
 *   node scripts/compat-parity.mjs --target dist    # frozen pre-migration baseline
 *
 * The consumer's own sources are read; nothing is written into the consumer repo.
 * tldraw itself is never read — the mapping replaces it.
 */
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const REPO = resolve(import.meta.dirname, "..")
const CONSUMER = resolve(arg("consumer", join(process.env.HOME, "Sites/symbio/molekula-app")))
const TARGET = arg("target", "src")           // "src" (live) | "dist" (frozen baseline)
const SCOPE = arg("scope", "canvas")           // "canvas" | "all"
const OUT = arg("out", join(REPO, "apps/bench/results/parity.json"))

if (!existsSync(CONSUMER)) {
  console.error(`consumer app not found: ${CONSUMER}`)
  process.exit(2)
}

const pkg = (name) =>
  TARGET === "dist"
    ? join(REPO, `packages/${name}/dist/index.d.ts`)
    : join(REPO, `packages/${name}/src/index.ts`)

// `tldraw` and every `@tldraw/*` entry point collapse onto the mocanvas surface.
const paths = {
  tldraw: [pkg("compat")],
  "@tldraw/editor": [pkg("editor")],
  "@tldraw/store": [pkg("store")],
  "@tldraw/state": [pkg("state")],
  "@tldraw/state-react": [
    TARGET === "dist"
      ? join(REPO, "packages/state/dist/react.d.ts")
      : join(REPO, "packages/state/src/react.ts"),
  ],
  "@tldraw/tlschema": [pkg("editor")],
  "@tldraw/utils": [pkg("editor")],
  "@tldraw/sync": [pkg("sync")],
  "@tldraw/sync-core": [pkg("sync")],
  "@mocanvas/compat": [pkg("compat")],
  "@mocanvas/editor": [pkg("editor")],
  "@mocanvas/mocanvas": [pkg("mocanvas")],
  "@mocanvas/store": [pkg("store")],
  "@mocanvas/state": [pkg("state")],
  "@mocanvas/sync": [pkg("sync")],
  "@mocanvas/wasm": [pkg("wasm")],
  "@/*": [join(CONSUMER, "packages/canvas/src/*")],
}

const include =
  SCOPE === "all"
    ? [join(CONSUMER, "packages/canvas/src/**/*"), join(CONSUMER, "apps/web/components/canvases/**/*")]
    : [join(CONSUMER, "packages/canvas/src/**/*")]

const dir = mkdtempSync(join(tmpdir(), "mocanvas-parity-"))
const tsconfig = {
  compilerOptions: {
    // Mirrors the consumer's own strictness (@molekula/typescript-config/library.json).
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
    forceConsistentCasingInFileNames: true,
    moduleResolution: "Bundler",
    module: "ESNext",
    target: "ES2022",
    lib: ["ES2023", "DOM", "DOM.Iterable"],
    jsx: "react-jsx",
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    isolatedModules: true,
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    noEmit: true,
    composite: false,
    // No ambient type packages: the consumer's jest-dom/vitest/node globals are
    // irrelevant here and are filtered out of the count as toolchain noise below.
    types: [],
    baseUrl: join(CONSUMER, "packages/canvas"),
    paths,
  },
  include,
}
const cfgPath = join(dir, "tsconfig.json")
writeFileSync(cfgPath, JSON.stringify(tsconfig, null, 2))

const tsc = join(REPO, "node_modules/typescript/bin/tsc")
const res = spawnSync(process.execPath, [tsc, "-p", cfgPath, "--pretty", "false"], {
  cwd: REPO,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
const out = (res.stdout || "") + (res.stderr || "")

if (args.includes("--debug") || !out.trim()) {
  console.error("--- tsc exit:", res.status, res.error ? String(res.error) : "")
  console.error("--- config:", cfgPath)
  console.error(out.split("\n").slice(0, 30).join("\n"))
}

const DIAG = /^(.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const diags = []
for (const line of out.split("\n")) {
  const m = DIAG.exec(line)
  // tsc prints paths relative to its cwd; make them absolute before classifying.
  if (m) diags.push({ file: resolve(REPO, m[1]), line: +m[2], code: m[4], message: m[5] })
}

// Which mocanvas symbols the failures point at.
const symbolOf = (d) => {
  let m
  if ((m = /has no exported member(?: named)? '([^']+)'/.exec(d.message))) return m[1]
  if ((m = /Property '([^']+)' does not exist/.exec(d.message))) return m[1]
  if ((m = /Cannot find name '([^']+)'/.exec(d.message))) return m[1]
  if ((m = /Module '"([^"]+)"' has no/.exec(d.message))) return m[1]
  if ((m = /'([^']+)' is not assignable/.exec(d.message))) return m[1]
  return null
}

// A diagnostic counts as "surface" if it is in a file that imports the remapped
// module and is not merely a missing ambient type from the consumer's own toolchain.
// Failures that belong to the consumer's own toolchain (CSS modules, jest-dom
// matchers, node builtins, vitest globals) rather than to the mocanvas surface.
const TOOLCHAIN = new RegExp(
  [
    "Cannot find module '[^']*\\.(css|scss|svg|png|jpg|webp)'",
    "Cannot find module 'node:",
    "Cannot find module '(vite/client|node|vitest[^']*)'",
    "Cannot find name '(process|__dirname|global|vi|describe|it|expect|beforeEach|afterEach|beforeAll|afterAll)'",
    "does not exist on type 'Assertion",
    "does not exist on type 'ImportMeta'",
    "Cannot find namespace 'NodeJS'",
  ].join("|"),
)
const CANVAS_SRC = join(CONSUMER, "packages/canvas/src")
for (const d of diags) d.surface = d.file.startsWith(CANVAS_SRC) && !TOOLCHAIN.test(d.message)

const samples = {}
const byCode = {}, bySymbol = {}, byFile = {}
for (const d of diags.filter((x) => x.surface)) {
  byCode[d.code] = (byCode[d.code] ?? 0) + 1
  byFile[d.file.replace(CONSUMER + "/", "")] = (byFile[d.file.replace(CONSUMER + "/", "")] ?? 0) + 1
  const s = symbolOf(d)
  if (s) bySymbol[s] = (bySymbol[s] ?? 0) + 1
  ;(samples[d.code] ??= []).length < 3 && samples[d.code].push(
    `${d.file.replace(CONSUMER + "/", "")}:${d.line}  ${d.message}`)
}
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n)

const report = {
  when: new Date().toISOString(),
  consumer: CONSUMER,
  target: TARGET,
  scope: SCOPE,
  totalErrors: diags.filter((d) => d.surface).length,
  toolchainNoiseIgnored: diags.filter((d) => !d.surface).length,
  samples,
  filesWithErrors: Object.keys(byFile).length,
  byCode, bySymbol, byFile,
}
mkdirSync(join(REPO, "apps/bench/results"), { recursive: true })
writeFileSync(OUT, JSON.stringify(report, null, 2))

console.log(`\nconsumer   ${CONSUMER}`)
console.log(`target     mocanvas ${TARGET}`)
console.log(`scope      ${SCOPE}`)
const surface = diags.filter((d) => d.surface)
console.log(`\nSURFACE ERRORS: ${surface.length}   across ${Object.keys(byFile).length} files`)
console.log(`(ignored ${diags.length - surface.length} diagnostics outside packages/canvas/src or from the consumer's own toolchain types)\n`)
if (surface.length) {
  console.log("top diagnostic codes:")
  for (const [c, n] of top(byCode, 10)) console.log(`  ${String(n).padStart(5)}  ${c}`)
  console.log("\ntop symbols implicated:")
  for (const [s, n] of top(bySymbol, 30)) console.log(`  ${String(n).padStart(5)}  ${s}`)
  console.log("\ntop files:")
  for (const [f, n] of top(byFile, 15)) console.log(`  ${String(n).padStart(5)}  ${f}`)
  console.log("\nsample messages:")
  for (const [c, list] of Object.entries(samples).slice(0, 8))
    for (const line of list.slice(0, 2)) console.log(`  ${c}  ${line}`)
}
console.log(`\nwritten: ${OUT}`)
