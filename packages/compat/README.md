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
```

The package also re-exports everything from `@mocanvas/mocanvas`, so a single import
source works during a migration.

What does and does not carry over is listed in `COMPAT.md`; the step-by-step
move is in `MIGRATION.md`. Both are shipped inside this package.

## Clean room

mocanvas has never been built by reading tldraw's source. It is written from
first principles against the public API reference on tldraw.dev, and the
compatibility these aliases provide is measured against that same reference.
Names are not copyrightable expression (*Google v. Oracle*, 2021); the
implementation behind them is original work under MIT. `CLEAN_ROOM.md`, shipped
in this package, is the full policy.

mocanvas is not affiliated with or endorsed by tldraw.

ESM only.

## License

MIT
