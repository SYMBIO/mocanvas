import { describe, expect, it } from "vitest"
import { forwardRef, memo } from "react"
import { track, useAtom, useComputed, useQuickReactor, useReactor, useValue } from "./react"

/**
 * No DOM here: these tests only check the module wiring of the React entry.
 * The reactive behaviour behind the hooks is covered in tracker.test.ts.
 */

const REACT_MEMO_TYPE = Symbol.for("react.memo")
const REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref")

describe("@mocanvas/state/react", () => {
	it("exports the hooks", () => {
		for (const hook of [useValue, useAtom, useComputed, useReactor, useQuickReactor, track]) {
			expect(typeof hook).toBe("function")
		}
	})

	it("track wraps a plain function component in memo and keeps its name", () => {
		function Panel() {
			return null
		}
		const Tracked = track(Panel) as unknown as { $$typeof: symbol; type: { displayName: string } }
		expect(Tracked.$$typeof).toBe(REACT_MEMO_TYPE)
		expect(Tracked.type.displayName).toBe("Panel")
	})

	it("track unwraps memo() components and preserves a custom comparator", () => {
		const compare = () => true
		const Inner = memo(function Inner() {
			return null
		}, compare)
		const Tracked = track(Inner) as unknown as { $$typeof: symbol; compare: unknown }
		expect(Tracked.$$typeof).toBe(REACT_MEMO_TYPE)
		expect(Tracked.compare).toBe(compare)
	})

	it("track supports forwardRef() components", () => {
		const WithRef = forwardRef<HTMLDivElement, object>(function WithRef() {
			return null
		})
		const Tracked = track(WithRef) as unknown as { $$typeof: symbol; type: { $$typeof: symbol } }
		expect(Tracked.$$typeof).toBe(REACT_MEMO_TYPE)
		expect(Tracked.type.$$typeof).toBe(REACT_FORWARD_REF_TYPE)
	})

	it("track rejects class components and unknown values", () => {
		class Legacy {
			isReactComponent = true
			render() {
				return null
			}
		}
		;(Legacy.prototype as unknown as { isReactComponent: object }).isReactComponent = {}
		expect(() => track(Legacy as never)).toThrow(/class components/)
		expect(() => track({} as never)).toThrow(/expects a function component/)
	})
})
