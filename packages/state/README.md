# @mocanvas/state

The signals library behind mocanvas:
atoms, computed values, transactions, reactors, and optional React bindings.
No dependencies.

## Install

```bash
npm install @mocanvas/state
```

React is an optional peer dependency; you only need it for the
`@mocanvas/state/react` entry point.

## Use

```ts
import { atom, computed, react } from "@mocanvas/state"

const count = atom("count", 1)
const doubled = computed("doubled", () => count.get() * 2)

const stop = react("log", () => console.log(doubled.get())) // 2
count.set(21) // 42

stop()
```

With React:

```tsx
import { useValue, track } from "@mocanvas/state/react"

const Count = track(function Count() {
  return <span>{count.get()}</span>
})

// or, without wrapping the component:
function OtherCount() {
  return <span>{useValue(count)}</span>
}
```

ESM only. The rest of the family: `@mocanvas/mocanvas` (the batteries-included
canvas), `@mocanvas/editor`, `@mocanvas/store`, `@mocanvas/wasm`,
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

The full terms are in `LICENSE`, shipped in this package.
