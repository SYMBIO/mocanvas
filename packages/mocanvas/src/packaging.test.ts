/**
 * What the published tarball does when Node — not a bundler — loads it.
 *
 * The bug this guards against: `dist/index.js` used to carry
 * `import "./ui-4C5V5GYT.css"`, left there by the build. A bundler resolves a
 * bare CSS import happily, so every test in this repository and every app in
 * `apps/` kept passing. Node has no loader for `.css`, so every consumer who
 * imported the package outside a bundler — vitest, an SSR render, a script —
 * got `ERR_UNKNOWN_FILE_EXTENSION` at import time. Nothing here was testing
 * that path, which is exactly why it shipped.
 *
 * So this test does the one thing no bundler can do for it: it assembles the
 * packages the way npm installs them (each `publishConfig` folded into its
 * `package.json`, laid out flat under one `node_modules`, outside the
 * repository) and runs `node` against them.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"

const PACKAGES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

/** Every workspace package `@mocanvas/mocanvas` needs at runtime, plus itself. */
const WORKSPACE = ["state", "store", "wasm", "editor", "mocanvas"] as const

const distOf = (name: string) => path.join(PACKAGES_DIR, name, "dist")
const builtAll = WORKSPACE.every((name) => fs.existsSync(path.join(distOf(name), "index.js")))

let staging: string | undefined
afterAll(() => {
  if (staging) fs.rmSync(staging, { recursive: true, force: true })
})

/**
 * Lay the built packages out the way a consumer's `node_modules` holds them.
 *
 * npm folds `publishConfig` into `package.json` when it packs, which is what
 * moves `main`, `types` and `exports` from `src/*.ts` to `dist/*.js`. Reading
 * the workspace `package.json` as-is would test the development entry points
 * and prove nothing about the tarball, so fold it here too.
 */
function stageInstalledTree(): string {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "mocanvas-consumer-"))
  const nodeModules = path.join(root, "node_modules")
  fs.mkdirSync(path.join(nodeModules, "@mocanvas"), { recursive: true })

  for (const name of WORKSPACE) {
    const from = path.join(PACKAGES_DIR, name)
    const to = path.join(nodeModules, "@mocanvas", name)
    fs.mkdirSync(to, { recursive: true })

    const manifest = JSON.parse(fs.readFileSync(path.join(from, "package.json"), "utf8")) as Record<
      string,
      unknown
    > & { publishConfig?: Record<string, unknown>; files?: string[] }
    const { publishConfig, ...rest } = manifest
    const published = { ...rest, ...publishConfig }
    fs.writeFileSync(path.join(to, "package.json"), JSON.stringify(published, null, 2))

    // Copy in what `files` says the tarball carries, so an import that reaches
    // for something `files` leaves out fails here the way it would for a user.
    // Copied rather than symlinked on purpose: Node resolves a symlink to its
    // real path and then resolves that file's own imports from there, which
    // would send `@mocanvas/editor` back to the workspace source and quietly
    // test the wrong thing.
    for (const entry of manifest.files ?? []) {
      const source = path.join(from, entry)
      if (entry.includes("/") || !fs.existsSync(source)) continue
      fs.cpSync(source, path.join(to, entry), { recursive: true })
    }
  }

  // Third-party dependencies, flat, exactly as npm would hoist them. pnpm has
  // already worked out which copy each package resolves to, so take its answer
  // rather than guessing at a version directory under `.pnpm`.
  for (const name of WORKSPACE) {
    const own = path.join(PACKAGES_DIR, name, "node_modules")
    if (!fs.existsSync(own)) continue
    for (const entry of fs.readdirSync(own)) {
      if (entry.startsWith(".") || entry === "@mocanvas") continue
      const scoped = entry.startsWith("@")
      const children = scoped ? fs.readdirSync(path.join(own, entry)) : [""]
      for (const child of children) {
        const rel = scoped ? path.join(entry, child) : entry
        const target = path.join(nodeModules, rel)
        if (fs.existsSync(target)) continue
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.symlinkSync(fs.realpathSync(path.join(own, rel)), target)
      }
    }
  }

  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }))
  return root
}

/** Run a module in a fresh Node process, with no bundler and no loader hooks. */
function runInNode(root: string, source: string): string {
  const file = path.join(root, `probe-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(file, source)
  try {
    return execFileSync(process.execPath, [file], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    const e = error as { stderr?: string; stdout?: string; message?: string }
    throw new Error(`node ${path.basename(file)} failed:\n${e.stderr || e.stdout || e.message}`)
  }
}

describe.skipIf(!builtAll)("the published package, loaded by Node", () => {
  it("imports under plain Node ESM, with no bundler and no CSS loader", () => {
    staging ??= stageInstalledTree()

    // `ERR_UNKNOWN_FILE_EXTENSION` is thrown while the module graph is linked,
    // so reaching the assertion at all is most of the test.
    const out = runInNode(
      staging,
      `import * as mocanvas from "@mocanvas/mocanvas"
       if (typeof mocanvas.Mocanvas !== "function") {
         throw new Error("the package loaded but did not export Mocanvas")
       }
       console.log("ok")\n`,
    )

    expect(out.trim()).toBe("ok")
  }, 120_000)

  it("resolves the stylesheet at a stable, hash-free subpath", () => {
    staging ??= stageInstalledTree()

    const out = runInNode(
      staging,
      `import { readFileSync } from "node:fs"
       import { fileURLToPath } from "node:url"
       const url = import.meta.resolve("@mocanvas/mocanvas/mocanvas.css")
       const css = readFileSync(fileURLToPath(url), "utf8")
       if (!css.includes(".mocanvas")) throw new Error("that is not the stylesheet")
       console.log(url)\n`,
    )

    // A hashed name (`ui-4C5V5GYT.css`) is what made the old file impossible to
    // import: it changed with the contents, so no import line survived a release.
    expect(out.trim()).toMatch(/\/mocanvas\.css$/)
    expect(out.trim()).not.toMatch(/-[A-Z0-9]{8}\.css$/)
  }, 120_000)

  it("ships no import that only a bundler could resolve", () => {
    const offenders: string[] = []
    for (const name of WORKSPACE) {
      const dir = distOf(name)
      if (!fs.existsSync(dir)) continue
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".js")) continue
        const code = fs.readFileSync(path.join(dir, file), "utf8")
        for (const [, specifier] of code.matchAll(
          /(?:^|[\s;}])(?:import|export)\s*(?:[\w*{][^'"]*from\s*)?["']((?:\.|\/)[^"']*)["']/g,
        )) {
          if (specifier !== undefined && !/\.(?:js|mjs|cjs|json|node|wasm)$/.test(specifier)) {
            offenders.push(`${name}/dist/${file} → ${specifier}`)
          }
        }
      }
    }

    // Node resolves a relative import by extension. Anything else in here is a
    // bundler-only asset reference, and will throw for a consumer without one.
    expect(offenders).toEqual([])
  })
})

/**
 * The declarations a TypeScript consumer compiles against.
 *
 * A type error inside a dependency's `.d.ts` is the worst kind: it points into
 * our files, and the consumer's only lever is to change their own compiler
 * settings to satisfy us.
 */
describe("the published type declarations", () => {
  it("declare the lib the wasm bindings need, rather than making the consumer widen theirs", () => {
    // wasm-pack emits `[Symbol.dispose](): void` on every exported class, which
    // lives in `esnext.disposable`. Without the reference a consumer on any
    // ordinary target gets TS2550 pointing at our file.
    const dts = path.join(PACKAGES_DIR, "wasm", "pkg", "mocanvas.d.ts")
    if (!fs.existsSync(dts)) return
    const text = fs.readFileSync(dts, "utf8")
    expect(text).toContain('/// <reference lib="esnext.disposable" />')
    expect(text.indexOf('/// <reference'), "a reference directive is only honoured at the top of the file").toBeLessThan(
      text.indexOf("export class Engine"),
    )
  })
})
