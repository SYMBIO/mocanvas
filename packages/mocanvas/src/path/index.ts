/**
 * Authoring a shape's outline: the chainable {@link PathBuilder} and the
 * geometry one of its runs becomes.
 *
 * The encoded form the rest of mocanvas shares is still the engine's flat word
 * stream (`Geometry2d.toPathWords()`); this module is the *authoring* side of
 * it, and everything it produces goes through that same encoding.
 */
export { PathBuilder } from "./PathBuilder"
export type {
  BasePathBuilderOpts,
  DashedPathBuilderOpts,
  DrawPathBuilderDOpts,
  DrawPathBuilderOpts,
  NonePathBuilderOpts,
  PathBuilderOpts,
  PathBuilderToDOpts,
  SolidPathBuilderOpts,
} from "./PathBuilder"
export type { PathBuilderCommand, PathBuilderCommandOpts, PathBuilderLineOpts, PathDashTerminal } from "./commands"
export { PathBuilderGeometry2d } from "./PathBuilderGeometry2d"
