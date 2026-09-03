# Clean-room policy

mocanvas is an original work licensed under MIT. It is *shaped like* tldraw so
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
6. **If in doubt, name it differently** and add an alias in the compat package.

## Where the compat surface is documented

`docs/COMPAT.md` lists every public symbol that intentionally matches, and every
one that intentionally differs, with the migration note.
