# @mocanvas/compat

`TL`-prefixed type and value aliases over the mocanvas API, for projects moving an
existing tldraw app over. Every alias is a pure re-export — there is no runtime
code of its own — so you can switch imports first and rename at your own pace.

## Install

```bash
npm install @mocanvas/compat
```

## Use

```ts
import type { TLShape, TLShapeId, TLGeoShape } from "@mocanvas/compat"
import { Tldraw } from "@mocanvas/compat" // alias of <Mocanvas />
import "@mocanvas/mocanvas/mocanvas.css"
```

The package also re-exports everything from `@mocanvas/mocanvas`, so a single import
source works during a migration.

**The stylesheet import is required** if you render `<Tldraw />` — it is where
`import "tldraw/tldraw.css"` goes. Without it the toolbar, panels and menus
come up unstyled. It comes from `@mocanvas/mocanvas`, which this package
depends on; under a strict `node_modules` layout (pnpm's default) add
`@mocanvas/mocanvas` to your own dependencies so the import resolves.

> **Upgrading from 4.0.2 or earlier?** Add that line. Until 4.0.2
> `@mocanvas/mocanvas` imported its stylesheet from its own JavaScript entry,
> which worked under a bundler and threw
> `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".css"` under plain Node
> — vitest, SSR, a script. The JS entry no longer imports CSS, so your app does.

What does and does not carry over is listed in `COMPAT.md`; the step-by-step
move is in `MIGRATION.md`. Both are shipped inside this package.

## Clean room

mocanvas has never been built by reading tldraw's source. It is written from
first principles against the public API reference on tldraw.dev, and the
compatibility these aliases provide is measured against that same reference.
Names are not copyrightable expression (*Google v. Oracle*, 2021); the
implementation behind them is our own original work. `CLEAN_ROOM.md`, shipped
in this package, is the full policy.

mocanvas is not affiliated with or endorsed by tldraw.

ESM only.

## License

**Source-available, not open source.** Free to use for:

- personal, non-commercial projects;
- non-profit organisations;
- development, evaluation, testing and staging — including inside a for-profit
  company, so you can try it and build against it before committing;
- teaching and academic research.

**Shipping it in a commercial product, service or website needs a written
agreement with us.** That includes anything sold, anything that earns revenue
directly or through advertising, and internal tools running a for-profit
business.

To arrange one, or if you are unsure which side of the line you are on, write to
**mocanvas@symbio.agency** — we would rather answer the question than have you
guess.

The full terms are in `LICENSE`, shipped in this package.
