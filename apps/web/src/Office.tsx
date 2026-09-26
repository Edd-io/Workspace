import { useEffect } from 'react';
import { Hud } from './features/hud/Hud';
import { TerminalOverlay } from './features/terminal/TerminalOverlay';
import { startOfficeSync, useOffice } from './state/officeStore';
import { World } from './world/World';

export function Office({ onLoggedOut }: { onLoggedOut: () => void }) {
  useEffect(() => {
    startOfficeSync();
  }, []);

  // Keyboard shortcuts outside the terminal and dialogs (which handle their own keys):
  // Escape leaves the focused desk, V switches between the overview and the walk.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
