import type { BindingUtilConstructor } from "@mocanvas/editor"
import { ArrowBindingUtil } from "./ArrowBindingUtil"

export * from "./ArrowBindingUtil"
export * from "./arrow-terminals"
export * from "./arrow-info"
export * from "./arrow-target"

/** The built-in binding utils, in the order they are registered. */
export const defaultBindingUtils: BindingUtilConstructor[] = [ArrowBindingUtil]
