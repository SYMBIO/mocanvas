import { describe, expect, it } from "vitest"
import { StateNode, type StateNodeConstructor } from "./StateNode"

class Idle extends StateNode {
  static override id = "idle"
}
class Pointing extends StateNode {
  static override id = "pointing"
}
class Select extends StateNode {
  static override id = "select"
  static override initial = "idle"
  static override children = (): StateNodeConstructor[] => [Idle, Pointing]
}
class Draw extends StateNode {
  static override id = "draw"
}
class Root extends StateNode {
  static override id = "root"
  static override initial = "draw"
  static override children = (): StateNodeConstructor[] => [Select, Draw]
}

describe("StateNode.transition with a dotted path", () => {
  const root = () => new Root(null as never)

  it("enters the named descendant, not just the parent's initial state", () => {
    const r = root()
    r.enter({}, "initial")
    r.transition("select.pointing")
    expect(r.getCurrent()?.id).toBe("select")
    expect(r.getCurrent()?.getCurrent()?.id).toBe("pointing")
  })

  it("still lands on the initial child for a bare id", () => {
    const r = root()
    r.enter({}, "initial")
    r.transition("select")
    expect(r.getCurrent()?.getCurrent()?.id).toBe("idle")
  })

  it("names the missing segment when the head does not exist", () => {
    const r = root()
    r.enter({}, "initial")
    expect(() => r.transition("nope.deeper")).toThrow(/has no child "nope"/)
  })
})
