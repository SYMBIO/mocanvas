# @mocanvas/store

The document model behind mocanvas: a
reactive record store with a typed schema, migrations, record diffs and
`.tldr` file IO. Built on `@mocanvas/state`; no React.

## Install

```bash
npm install @mocanvas/store
```

## Use

```ts
import { createRecordType, Store, StoreSchema, type BaseRecord, type RecordId } from "@mocanvas/store"

interface Book extends BaseRecord<"book", RecordId<Book>> {
  title: string
}

const BookRecord = createRecordType<Book>("book", { scope: "document" })
const store = new Store({ schema: StoreSchema.create({ book: BookRecord }), props: {} })

store.listen(({ changes }) => console.log(changes))
store.put([BookRecord.create({ title: "Dune" })])
```

Records are reactive: `store.query` exposes signals you can read from
`@mocanvas/state` computeds and React components.

ESM only. The rest of the family: `@mocanvas/mocanvas` (the batteries-included
canvas), `@mocanvas/editor`, `@mocanvas/state`, `@mocanvas/wasm`,
`@mocanvas/sync` and `@mocanvas/compat`.

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

The full terms are in `LICENSE`, shipped in this package. Versions released
earlier under MIT stay available under MIT, on the terms they were released
with.
