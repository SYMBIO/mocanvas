# @mocanvas/compat

`TL`-prefixed type and value aliases over the
[mocanvas](https://github.com/SYMBIO/mocanvas) API, for projects moving an
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

What does and does not carry over is listed in
[docs/COMPAT.md](https://github.com/SYMBIO/mocanvas/blob/main/docs/COMPAT.md);
the step-by-step move is in
[docs/MIGRATION.md](https://github.com/SYMBIO/mocanvas/blob/main/docs/MIGRATION.md).

ESM only.

## License

MIT
