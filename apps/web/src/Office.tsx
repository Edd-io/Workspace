import { useEffect } from 'react';
import { Hud } from './features/hud/Hud';
import { useAttentionAlerts } from './features/notifications/useAttentionAlerts';
import { isSearchShortcut } from './features/search/shortcut';
import { audioContext } from './features/sound/chime';
import { requestSummary } from './features/summary/SummaryPanel';
import { TerminalOverlay } from './features/terminal/TerminalOverlay';
import { startOfficeSync, useOffice } from './state/officeStore';
import { World } from './world/World';

export function Office({ onLoggedOut }: { onLoggedOut: () => void }) {
  useEffect(() => {
    startOfficeSync();
    // Arriving at the office: Haiku summarizes what happened since the previous visit.
    void requestSummary('visit').catch(() => undefined);
    // Browsers only allow sound after a user gesture.
    const unlock = () => audioContext();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useAttentionAlerts();

  // Links from phone notifications: /?desk=<id> opens that desk's terminal once the office is loaded.
  const loaded = useOffice((state) => state.loaded);
  useEffect(() => {
    if (!loaded) return;
    const url = new URL(window.location.href);
    const deskId = url.searchParams.get('desk');
    if (!deskId) return;
    url.searchParams.delete('desk');
    window.history.replaceState(null, '', url);
    if (useOffice.getState().desks[deskId]) useOffice.getState().openTerminal(deskId);
  }, [loaded]);

  // Keyboard shortcuts outside the terminal and dialogs (which handle their own keys):
  // Escape leaves the focused desk, V switches between the overview and the walk, ⌘K / Ctrl+K searches.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSearchShortcut(event, useOffice.getState().terminalDeskId !== null)) {
        event.preventDefault();
        useOffice.getState().setPanel({ kind: 'search' });
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
        return;
      const { terminalDeskId, panel, focusDesk, viewMode, setViewMode } = useOffice.getState();
      if (terminalDeskId || panel) return;
      if (event.key === 'Escape' && viewMode === 'overview') focusDesk(null);
      if (event.code === 'KeyV') setViewMode(viewMode === 'walk' ? 'overview' : 'walk');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="office">
      <World />
      <Hud onLoggedOut={onLoggedOut} />
      <TerminalOverlay />
    </div>
  );
}
