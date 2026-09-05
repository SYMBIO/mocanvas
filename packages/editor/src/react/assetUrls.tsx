import { createContext, useContext, type ReactNode } from "react"

/**
 * Where an app self-hosts the files the UI loads at runtime.
 *
 * mocanvas itself needs none of them — its icons are inline SVG and it ships
 * no translation bundles — so the map is carried, not consumed: it exists so a
 * component an app drops into a chrome slot can ask for the same base paths
 * the host configured, instead of every such component growing a prop for it.
 *
 * Kept as nested string maps rather than a fixed shape because the categories
 * are the app's, not ours; the four named below are only the ones a
 * self-hosting setup usually has.
 */
export interface TLAssetUrls {
  fonts?: Readonly<Record<string, string>>
  icons?: Readonly<Record<string, string>>
  embedIcons?: Readonly<Record<string, string>>
  translations?: Readonly<Record<string, string>>
  [category: string]: Readonly<Record<string, string>> | undefined
}

/**
 * The editor's half of the map: the fonts the canvas loads.
 *
 * A separate name from {@link TLAssetUrls} because the editor package can only
 * promise what it itself uses — the UI layer adds icons and translations on
 * top, as {@link TLUiAssetUrls}.
 */
export interface TLEditorAssetUrls extends TLAssetUrls {
  fonts?: Readonly<Record<string, string>>
}

/**
 * The UI layer's half: the icons and translation bundles a self-hosting app
 * serves itself.
 */
export interface TLUiAssetUrls extends TLEditorAssetUrls {
  icons?: Readonly<Record<string, string>>
  embedIcons?: Readonly<Record<string, string>>
  translations?: Readonly<Record<string, string>>
}

const AssetUrlsContext = createContext<TLAssetUrls>({})

export interface AssetUrlsProviderProps {
  assetUrls: TLAssetUrls
  children?: ReactNode
}

/** Publishes an {@link TLAssetUrls} map to everything below it. */
export function AssetUrlsProvider({ assetUrls, children }: AssetUrlsProviderProps) {
  return <AssetUrlsContext.Provider value={assetUrls}>{children}</AssetUrlsContext.Provider>
}

/**
 * The asset urls the host configured. Empty outside a provider — a component
 * that needs a file should fall back to its own default rather than fail,
 * because most mounts configure nothing at all.
 */
export function useAssetUrls(): TLAssetUrls {
  return useContext(AssetUrlsContext)
}
