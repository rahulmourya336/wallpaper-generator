export type DevicePreset = {
  id: string
  label: string
  group: 'Phone' | 'Tablet' | 'Desktop'
  width: number
  height: number
}

export const PRESETS: readonly DevicePreset[] = [
  { id: 'iphone-17-pro', label: 'iPhone 17 Pro', group: 'Phone', width: 1206, height: 2622 },
  { id: 'iphone-15-pro', label: 'iPhone 15 / 16 Pro', group: 'Phone', width: 1179, height: 2556 },
  { id: 'iphone-plus', label: 'iPhone Plus / Pro Max', group: 'Phone', width: 1290, height: 2796 },
  { id: 'pixel-9', label: 'Pixel 9 / 10', group: 'Phone', width: 1080, height: 2424 },
  { id: 'galaxy-s24', label: 'Galaxy S24 Ultra', group: 'Phone', width: 1440, height: 3120 },
  { id: 'android-fhd', label: 'Android FHD+', group: 'Phone', width: 1080, height: 2340 },
  { id: 'ipad-pro-13', label: 'iPad Pro 13"', group: 'Tablet', width: 2064, height: 2752 },
  { id: 'ipad-air', label: 'iPad Air 11"', group: 'Tablet', width: 1640, height: 2360 },
  { id: 'tab-s9', label: 'Galaxy Tab S9', group: 'Tablet', width: 1848, height: 2960 },
  { id: 'desktop-1080', label: 'Desktop 1080p', group: 'Desktop', width: 1920, height: 1080 },
  { id: 'desktop-1440', label: 'Desktop 1440p', group: 'Desktop', width: 2560, height: 1440 },
  { id: 'desktop-4k', label: 'Desktop 4K', group: 'Desktop', width: 3840, height: 2160 },
  { id: 'macbook-14', label: 'MacBook Pro 14"', group: 'Desktop', width: 3024, height: 1964 },
  { id: 'macbook-16', label: 'MacBook Pro 16"', group: 'Desktop', width: 3456, height: 2234 },
  { id: 'ultrawide', label: 'Ultrawide 34"', group: 'Desktop', width: 3440, height: 1440 },
]

export const DEFAULT_PRESET_ID = 'iphone-15-pro'

/** Browsers refuse to allocate canvases beyond a few hundred megapixels. */
export const MAX_EXPORT_PIXELS = 80_000_000
export const MAX_EXPORT_EDGE = 16_384

export function getPreset(id: string): DevicePreset | undefined {
  return PRESETS.find((p) => p.id === id)
}

export function presetOr(id: string): DevicePreset {
  return getPreset(id) ?? (getPreset(DEFAULT_PRESET_ID) as DevicePreset)
}

export function groupedPresets(): ReadonlyArray<[DevicePreset['group'], DevicePreset[]]> {
  const groups: DevicePreset['group'][] = ['Phone', 'Tablet', 'Desktop']
  return groups.map((g) => [g, PRESETS.filter((p) => p.group === g)])
}

/**
 * A custom size is encoded into the preset id as `custom:WxH`, so it round
 * trips through the URL hash without adding a field to the state model.
 */
export const CUSTOM_PREFIX = 'custom:'

export type ResolvedSize = { id: string; label: string; width: number; height: number; custom: boolean }

export function makeCustomId(width: number, height: number): string {
  return `${CUSTOM_PREFIX}${Math.round(width)}x${Math.round(height)}`
}

export function resolveSize(id: string): ResolvedSize {
  if (id.startsWith(CUSTOM_PREFIX)) {
    const m = /^custom:(\d{1,5})x(\d{1,5})$/.exec(id)
    if (m) {
      const width = Number(m[1])
      const height = Number(m[2])
      if (width >= 16 && height >= 16) {
        return { id, label: `Custom ${width}×${height}`, width, height, custom: true }
      }
    }
  }
  const preset = presetOr(id)
  return { id: preset.id, label: preset.label, width: preset.width, height: preset.height, custom: false }
}

/**
 * Bands of the screen that the OS covers on a lock or home screen. Fractions of
 * the height, measured from the top. The point is not precision — it is showing
 * the user which part of their composition the clock is going to sit on.
 */
export type SafeZone = { from: number; to: number; label: string }

export function safeZones(group: DevicePreset['group']): readonly SafeZone[] {
  if (group === 'Desktop') {
    return [
      { from: 0, to: 0.045, label: 'Menu bar' },
      { from: 0.9, to: 1, label: 'Dock' },
    ]
  }
  if (group === 'Tablet') {
    return [
      { from: 0, to: 0.06, label: 'Status' },
      { from: 0.08, to: 0.24, label: 'Clock' },
      { from: 0.92, to: 1, label: 'Dock' },
    ]
  }
  return [
    { from: 0, to: 0.055, label: 'Status' },
    { from: 0.1, to: 0.3, label: 'Clock' },
    { from: 0.88, to: 1, label: 'Controls' },
  ]
}

/** Which group a bare width/height most resembles, for the safe-zone overlay. */
export function groupForRatio(width: number, height: number): DevicePreset['group'] {
  const aspect = width / height
  if (aspect >= 1.2) return 'Desktop'
  if (aspect >= 0.66) return 'Tablet'
  return 'Phone'
}

/** The three ratios the export dialog previews side by side. */
export const PREVIEW_RATIOS: ReadonlyArray<{ id: string; label: string; width: number; height: number }> = [
  { id: 'phone', label: 'Phone', width: 1179, height: 2556 },
  { id: 'tablet', label: 'Tablet', width: 1640, height: 2360 },
  { id: 'desktop', label: 'Desktop', width: 2560, height: 1440 },
]
