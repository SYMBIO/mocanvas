# @mocanvas/state

The signals library behind [mocanvas](https://github.com/SYMBIO/mocanvas):
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

ESM only. See the [repository](https://github.com/SYMBIO/mocanvas) for the
rest of the packages.

## License

MIT
