/** macOS (and iOS) use ⌘ where other systems use Ctrl. */
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** Label of a ⌘ / Ctrl shortcut, e.g. `modKey('K')` → "⌘K" or "Ctrl+K". */
export function modKey(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}
