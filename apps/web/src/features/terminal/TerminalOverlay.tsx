import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/http';
import { officeSocket } from '../../api/socket';
import { useOffice } from '../../state/officeStore';
import { roleLabel } from '../rooms/roomTemplates';
import { StateBadge } from '../hud/StateBadge';

const TERMINAL_THEME = {
  background: '#0d1117',
  foreground: '#d0d7de',
  cursor: '#e07a5f',
  selectionBackground: '#264f78',
};

export function TerminalOverlay() {
  const deskId = useOffice((state) => state.terminalDeskId);
  if (!deskId) return null;
  return <TerminalWindow key={deskId} deskId={deskId} />;
}

function TerminalWindow({ deskId }: { deskId: string }) {
  const { t } = useTranslation();
  const desk = useOffice((state) => state.desks[deskId]);
  const room = useOffice((state) => (desk ? state.rooms[desk.roomId] : undefined));
  const closeTerminal = useOffice((state) => state.closeTerminal);
  const setPanel = useOffice((state) => state.setPanel);
  const stats = useOffice((state) => (deskId ? state.deskStats[deskId] : undefined));
  const containerRef = useRef<HTMLDivElement>(null);
  const [closedReason, setClosedReason] = useState<'offline' | 'removed' | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 14,
      lineHeight: 1.1,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);
    if (import.meta.env.DEV) (window as unknown as { __terminal?: Terminal }).__terminal = terminal;
    try {
      terminal.loadAddon(new WebglAddon());
    } catch {
      // WebGL unavailable: xterm falls back to its DOM renderer.
    }

    let ready = false;
    const sendResize = () =>
      officeSocket.send({ t: 'term.resize', deskId, cols: terminal.cols, rows: terminal.rows });

    const offMessage = officeSocket.onMessage((message) => {
      if (!('deskId' in message) || message.deskId !== deskId) return;
      if (message.t === 'term.snapshot') {
        // Replay the snapshot at its original size, then adopt the size of this window.
        ready = false;
        terminal.reset();
        terminal.resize(message.cols, message.rows);
        terminal.write(message.data, () => {
          ready = true;
          setClosedReason(null);
          fit.fit();
          sendResize();
        });
      } else if (message.t === 'term.data' && ready) {
        terminal.write(message.data);
      } else if (message.t === 'term.closed') {
        setClosedReason(message.reason);
      }
    });
    const closeSubscription = officeSocket.openTerminal(deskId, 'interactive');
    const dataListener = terminal.onData((data) => officeSocket.send({ t: 'term.input', deskId, data }));
    const resizeListener = terminal.onResize(() => {
      if (ready) sendResize();
    });
    const observer = new ResizeObserver(() => {
      if (ready) fit.fit();
    });
    observer.observe(container);
    terminal.focus();

    return () => {
      observer.disconnect();
      dataListener.dispose();
      resizeListener.dispose();
      offMessage();
      closeSubscription();
      terminal.dispose();
    };
  }, [deskId]);

  if (!desk) return null;

  const restart = () => void api('POST', `/api/desks/${deskId}/restart`);
  const start = () => void api('POST', `/api/desks/${deskId}/start`);
  const offline = desk.state === 'offline' || closedReason !== null;

  return (
    <div
      className="terminal-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && closeTerminal()}
    >
      <div className="terminal-window panel" onKeyDown={(event) => event.stopPropagation()}>
        <header className="terminal-window__header">
          <div className="terminal-window__title">
            <strong>{desk.name}</strong>
            <span className="muted">{room?.name}</span>
            {desk.role && (
              <span className="tag" title={desk.role}>
                {roleLabel(desk.role)}
              </span>
            )}
            {desk.branch && <code className="muted">{desk.branch}</code>}
            {stats && (stats.model || stats.contextPercent !== null) && (
              <span className="muted">
                {[
                  stats.model,
                  stats.contextPercent !== null && t('usage.context', { percent: stats.contextPercent }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </div>
          <StateBadge state={desk.state} />
          <div className="terminal-window__actions">
            {desk.mode === 'worktree' && (
              <button className="button" onClick={() => setPanel({ kind: 'integrate', deskId: desk.id })}>
                {t('integration.open')}
              </button>
            )}
            {offline ? (
              <button className="button" onClick={start}>
                {t('desk.actions.start')}
              </button>
            ) : (
              <button className="button" onClick={restart}>
                {t('desk.actions.restart')}
              </button>
            )}
            <button className="button" onClick={closeTerminal} aria-label={t('common.close')}>
              {t('common.close')}
            </button>
          </div>
        </header>
        <div className="terminal-window__body">
          <div ref={containerRef} className="terminal-window__xterm" />
          {offline && (
            <div className="terminal-window__notice">
              {closedReason === 'removed' ? t('terminal.removed') : t('terminal.offline')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
