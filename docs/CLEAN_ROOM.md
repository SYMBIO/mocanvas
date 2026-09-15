# Clean-room policy

mocanvas is an original work. It is *shaped like* tldraw so
that projects can migrate, but it is not derived from it.

## Rules for contributors (human or agent)

1. **Never open tldraw source.** Not the GitHub repository, not a copy in some
   `node_modules`, not a fork, not a gist of it. This includes reading it "just
   to check how they did X".
2. **Allowed inputs:** the public API reference and guides on tldraw.dev, blog
   posts, conference talks, sample `.tldr` files produced by the app, and your
   own knowledge of computational geometry, rendering, and reactive systems.
3. **What compatibility means here:** the same *names* for public types,
   methods, record fields, style values and file-envelope fields where that
   makes migration mechanical. Names are not copyrightable expression
   (*Google v. Oracle*, 2021). Implementation is written from first principles.
4. **No branding.** No tldraw logos, watermarks, product names, company names,
   links to their services, or their asset URLs anywhere in the codebase. The
   only permitted literal is the `.tldr` envelope field `tldrawFileFormatVersion`,
   which is part of the file format we read and write.
5. **Dependencies must be MIT, Apache-2.0, BSD, ISC, CC0 or 0BSD.** Check the
   license before adding a crate or npm package. `cargo deny` and
   `license-checker` run in CI.
6. **Vendored third-party assets follow rule 5 and must be listed in `NOTICE`.**
   Artwork, fonts and data copied into this repository rather than installed
   count here even though no package manager sees them. Record where the
   material came from, at which version, and by which script — and never
   vendor material whose licence rule 5 would not have allowed as a dependency.
   The icon set's Phosphor artwork is the worked example.
7. **If in doubt, name it differently** and add an alias in the compat package.

## The one exception: `apps/bench`

`apps/bench` is a private, never-published benchmark harness. It is the only
place in this repository that may depend on `tldraw`, name it, or read its
`.d.ts` declaration files, and it does so purely to drive the other library
through its public API so the two can be measured and their rendering compared.

The exception is bounded:

- `apps/bench` is `"private": true` and is never published.
- Nothing under `packages/**` or `apps/playground` may import it, import
  `tldraw`, or mention it.
- Reading tldraw's *implementation* (bundled `.js`/`.mjs`, or its source) is
  still forbidden there. Declaration files and public documentation only.
- No code is copied in either direction. The fixture in
  `apps/bench/public/compare.tldr` is data produced by running the other
  library, which is exactly the kind of sample document rule 2 permits.
- License tooling (`license-checker`, `cargo deny`) must therefore *exclude*
  `apps/bench` rather than have rule 5's allowlist relaxed for everyone.

## Where the compat surface is documented

`docs/COMPAT.md` lists every public symbol that intentionally matches, and every
one that intentionally differs, with the migration note.
