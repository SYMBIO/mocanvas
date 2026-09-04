# @mocanvas/store

The document model behind [mocanvas](https://github.com/SYMBIO/mocanvas): a
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

ESM only. See the [repository](https://github.com/SYMBIO/mocanvas) for the
rest of the packages.

## License

MIT
