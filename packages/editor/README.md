# @mocanvas/editor

The editor core of mocanvas, without the
default shapes, tools and UI: the `Editor` facade, `ShapeUtil` and
`BindingUtil`, the `StateNode` tool state machine, geometry, snapping, history,
textures, and the `<Canvas />` React renderer with its WebGL2 backend.

Use this package when you want to build your own shape set and UI. If you want
a canvas that works out of the box, use `@mocanvas/mocanvas`.

## Install

```bash
npm install @mocanvas/editor react react-dom
```

`react` and `react-dom` (>= 18) are peer dependencies.

This package ships no stylesheet: `<Canvas />` carries its own fallbacks for
the theme custom properties, so it renders correctly on its own. The default
UI theme is `@mocanvas/mocanvas/mocanvas.css`, and you import it only if you
also render that package's UI.

## Use

```tsx
import { Canvas, Editor, createStore, loadEngine } from "@mocanvas/editor"
import { useEffect, useRef, useState } from "react"

export function MyCanvas() {
  const container = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<Editor | null>(null)

  useEffect(() => {
    let disposed = false
    loadEngine().then((engine) => {
      if (disposed) return engine.dispose()
      setEditor(
        new Editor({
          store: createStore(),
          shapeUtils: [], // your ShapeUtils
          tools: [], // your StateNodes
          engine,
          getContainer: () => container.current!,
        }),
      )
    })
    return () => {
      disposed = true
    }
  }, [])

  return (
    <div ref={container} style={{ position: "absolute", inset: 0 }}>
      {editor && <Canvas editor={editor} />}
    </div>
  )
}
```

Writing a shape util and its tool is covered in `CUSTOM_SHAPES.md`, shipped
inside this package.

ESM only. The WebAssembly engine is loaded from `@mocanvas/wasm`; see that
package's README for how the `.wasm` file is resolved by your bundler.

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
