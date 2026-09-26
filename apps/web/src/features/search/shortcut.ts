const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** Shown in the search button's tooltip. */
export const SEARCH_SHORTCUT = isMac ? '⌘K' : 'Ctrl+K';

/**
 * ⌘K on macOS, Ctrl+K elsewhere — except in an open terminal, where Ctrl+K belongs to the shell
 * (it deletes to the end of the line).
 */
export function isSearchShortcut(event: KeyboardEvent, terminalOpen: boolean): boolean {
  if (event.code !== 'KeyK' || event.altKey || event.shiftKey) return false;
  if (isMac) return event.metaKey && !event.ctrlKey;
  return event.ctrlKey && !event.metaKey && !terminalOpen;
}
