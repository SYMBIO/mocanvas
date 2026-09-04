# @mocanvas/editor

The editor core of [mocanvas](https://github.com/SYMBIO/mocanvas), without the
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

Writing a shape util and its tool is covered in
[docs/CUSTOM_SHAPES.md](https://github.com/SYMBIO/mocanvas/blob/main/docs/CUSTOM_SHAPES.md).

ESM only. The WebAssembly engine is loaded from `@mocanvas/wasm`; see that
package's README for how the `.wasm` file is resolved by your bundler.

## License

MIT
