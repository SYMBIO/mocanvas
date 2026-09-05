/**
 * The configuration seam for embedded third-party pages.
 *
 * mocanvas ships the *mechanism* — a permit list of hosts, a per-service
 * settings map, and a permissions policy for the iframe — and a small set of
 * built-in definitions. What it deliberately does not ship is any code that
 * talks to somebody else's hosted API: an embed is a URL rewrite and an
 * `<iframe>`, never a fetch. An app that needs a service mocanvas has never
 * heard of adds a {@link CustomEmbedDefinition} rather than waiting for one.
 *
 * ```ts
 * const Embeds = EmbedShapeUtil.configure({
 *   embedDefinitions: [...DEFAULT_EMBED_DEFINITIONS, myIntranet],
 *   embedConfig: { "google-maps": { apiKey: MAPS_KEY } },
 * })
 * ```
 *
 * The definitions and the util live in `shapes/EmbedShapeUtil`; this module is
 * the typed surface an app configures them through.
 */

import type { EmbedDefinition, EmbedInfo, EmbedSettings } from "../shapes/EmbedShapeUtil"

/** The services recognised out of the box, by their stable ids. */
export type DefaultEmbedDefinitionType = "youtube" | "vimeo" | "codesandbox" | "figma" | "google-maps" | "excalidraw"

/**
 * An embed definition supplied by the app.
 *
 * Structurally the same as a built-in one — which is the point: there is no
 * privileged category of embed, and a custom definition can do anything a
 * built-in does, including declaring an aspect ratio and recovering a page url
 * from an embed url.
 */
export interface CustomEmbedDefinition extends EmbedDefinition {}

/**
 * Google Maps needs a key to embed anything beyond a basic map, so it is the
 * one built-in with settings worth naming.
 */
export interface GoogleMapsEmbedConfig extends EmbedSettings {
  /** Maps Embed API key. Ends up in the iframe url, so it must be a browser-restricted key. */
  apiKey?: string
  /** Two-letter language for the map's labels. */
  language?: string
  /** Two-letter region, biasing place names and borders. */
  region?: string
}

/**
 * Settings for the built-in services, keyed by service id.
 *
 * The only route a key takes into an embed url: a definition is handed its own
 * entry and nothing else, so one service's configuration can never leak into
 * another's request.
 */
export interface DefaultEmbedConfig extends Partial<Record<DefaultEmbedDefinitionType, EmbedSettings>> {
  "google-maps"?: GoogleMapsEmbedConfig
}

/**
 * What resolving a url against the permit list produced, or `undefined` when
 * the url is not one that gets embedded.
 */
export type TLEmbedResult = EmbedInfo | undefined

/**
 * The permissions an embedded page is granted by default, as iframe
 * permissions-policy features.
 *
 * Everything that can reach the user's hardware or identity is off. What is on
 * is only what a media player needs to be a media player: full screen, sound
 * without a second click, DRM playback, picture-in-picture, and the motion
 * sensors a 360° video reads. A definition may widen this for its own service;
 * nothing widens it for a service that is not on the permit list, because
 * nothing off the permit list is ever put in an iframe at all.
 *
 * The documented `TLEmbedShapePermissions` alias for this object's shape is
 * published from the shapes module alongside the embed util.
 */
export const embedShapePermissionDefaults = {
  "accelerometer": true,
  "autoplay": true,
  "clipboard-write": false,
  "encrypted-media": true,
  "fullscreen": true,
  "gyroscope": true,
  "picture-in-picture": true,
  "camera": false,
  "display-capture": false,
  "geolocation": false,
  "microphone": false,
  "midi": false,
  "payment": false,
  "screen-wake-lock": false,
  "usb": false,
  "web-share": false,
  "xr-spatial-tracking": false,
} as const

/**
 * The `allow` attribute for an iframe, built from a permissions map.
 *
 * Only the features that are on are listed; a feature that is absent from the
 * attribute is denied, so an explicit `false` and an omission mean the same
 * thing to the browser.
 */
export function embedPermissionsToAllowAttribute(permissions: Readonly<Record<string, boolean>>): string {
  return Object.entries(permissions)
    .filter(([, allowed]) => allowed)
    .map(([feature]) => feature)
    .join("; ")
}
