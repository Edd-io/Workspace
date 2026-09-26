import { useEffect } from 'react';
import { Hud } from './features/hud/Hud';
import { TerminalOverlay } from './features/terminal/TerminalOverlay';
import { startOfficeSync, useOffice } from './state/officeStore';
import { World } from './world/World';

export function Office({ onLoggedOut }: { onLoggedOut: () => void }) {
  useEffect(() => {
    startOfficeSync();
  }, []);

  // Escape leaves the focused desk and returns to the overview (terminal and dialogs handle their own keys).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const { terminalDeskId, panel, focusDesk } = useOffice.getState();
      if (!terminalDeskId && !panel) focusDesk(null);
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
