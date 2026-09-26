import { ATTENTION_STATES, DESK_STATES, type DeskState } from '@workspace/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/http';
import { deskTopic } from '../../lib/desk';
import { InboxPanel } from '../inbox/InboxPanel';
import { MapPanel } from '../map/MapPanel';
import { SummaryPanel } from '../summary/SummaryPanel';
import { TimelinePanel } from '../timeline/TimelinePanel';
import { attentionDesks, desksOfRoom, sortedRooms, useOffice } from '../../state/officeStore';
import { RoomBoardDialog } from '../board/RoomBoardDialog';
import { CreateDeskDialog } from './CreateDeskDialog';
import { CreateRoomDialog } from './CreateRoomDialog';
import { DeskMenu } from './DeskMenu';
import { IntegrationDialog } from '../integration/IntegrationDialog';
import { NotificationsDialog } from '../notifications/NotificationsDialog';
import { UsageGauge } from '../usage/UsageGauge';
import { Minimap } from './Minimap';
import { SettingsMenu } from './SettingsMenu';
import { Toasts } from './Toasts';
import { StateDot } from './StateBadge';

export function Hud({ onLoggedOut }: { onLoggedOut: () => void }) {
  return (
    <>
      <TopBar onLoggedOut={onLoggedOut} />
      <OfficeSidebar />
      <Minimap />
      <WalkHints />
      <Toasts />
      <Dialogs />
    </>
  );
}

function TopBar({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { t } = useTranslation();
  const connection = useOffice((state) => state.connection);
  const desks = useOffice((state) => state.desks);
  const setPanel = useOffice((state) => state.setPanel);
  const counts = useMemo(() => {
    const result = new Map<DeskState, number>();
    for (const desk of Object.values(desks)) result.set(desk.state, (result.get(desk.state) ?? 0) + 1);
    return result;
  }, [desks]);

  return (
    <header className="topbar panel">
      <div className="topbar__brand">
        <span className={`connection connection--${connection}`} title={t(`connection.${connection}`)} />
        <strong>{t('app.name')}</strong>
      </div>
      <div className="topbar__counts">
        {DESK_STATES.filter((state) => counts.has(state)).map((state) => (
          <span
            key={state}
            className={`count-chip${ATTENTION_STATES.has(state) ? ' count-chip--attention' : ''}`}
            title={t(`states.${state}`)}
          >
            <StateDot state={state} />
            {counts.get(state)}
          </span>
        ))}
      </div>
      <UsageGauge />
      <div className="topbar__actions">
        <InboxButton />
        <button className="button button--ghost" onClick={() => setPanel({ kind: 'summary' })}>
          {t('summary.button')}
        </button>
        <button className="button button--ghost" onClick={() => setPanel({ kind: 'timeline' })}>
          {t('timeline.button')}
        </button>
        <ViewModeSwitch />
        <SettingsMenu onLoggedOut={onLoggedOut} />
      </div>
    </header>
  );
}

function OfficeSidebar() {
  const { t } = useTranslation();
  const rooms = useOffice((state) => state.rooms);
  const desks = useOffice((state) => state.desks);
  const loaded = useOffice((state) => state.loaded);
  const focusedDeskId = useOffice((state) => state.focusedDeskId);
  const openTerminal = useOffice((state) => state.openTerminal);
  const setPanel = useOffice((state) => state.setPanel);
  const collapsed = useOffice((state) => state.sidebarCollapsed);
  const setCollapsed = useOffice((state) => state.setSidebarCollapsed);
  const [menuDeskId, setMenuDeskId] = useState<string | null>(null);
  const roomList = sortedRooms(rooms);

  if (collapsed) {
    return (
      <button className="sidebar-toggle panel" onClick={() => setCollapsed(false)}>
        {t('sidebar.show')}
      </button>
    );
  }

  return (
    <aside className="sidebar panel">
      <div className="sidebar__header">
        <h2>{t('sidebar.title')}</h2>
        <button className="button button--ghost button--small" onClick={() => setCollapsed(true)}>
          {t('sidebar.hide')}
        </button>
      </div>
      <div className="sidebar__content">
        {loaded && roomList.length === 0 && <p className="muted">{t('sidebar.empty')}</p>}
        {roomList.map((room) => (
          <section key={room.id} className="sidebar-room">
            <div className="sidebar-room__header">
              <span className="sidebar-room__swatch" style={{ background: room.accentColor }} />
              <span className="sidebar-room__name" title={room.projectPath}>
                {room.name}
              </span>
              <button
                className="button button--ghost button--small"
                onClick={() => setPanel({ kind: 'board', roomId: room.id })}
                title={t('sidebar.openBoard')}
              >
                {t('sidebar.board')}
              </button>
              <button
                className="button button--ghost button--small"
                onClick={() => setPanel({ kind: 'createDesk', roomId: room.id })}
                title={t('sidebar.addDesk')}
              >
                +
              </button>
            </div>
            <ul className="sidebar-room__desks">
              {desksOfRoom(desks, room.id).map((desk) => (
                <li
                  key={desk.id}
                  className={`sidebar-desk${desk.id === focusedDeskId ? ' sidebar-desk--focused' : ''}`}
                >
                  <button
                    className="sidebar-desk__main"
                    onClick={() => openTerminal(desk.id)}
                    title={desk.role ?? undefined}
                  >
                    <StateDot state={desk.state} />
                    <span className="sidebar-desk__name">{desk.name}</span>
                    <span className="sidebar-desk__task muted">
                      {deskTopic(desk) ?? t(`states.${desk.state}`)}
                    </span>
                  </button>
                  <button
                    className="button button--ghost button--small"
                    onClick={() => setMenuDeskId(menuDeskId === desk.id ? null : desk.id)}
                    aria-label={t('desk.menu')}
                  >
                    ⋯
                  </button>
                  {menuDeskId === desk.id && <DeskMenu desk={desk} onClose={() => setMenuDeskId(null)} />}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <button
        className="button button--primary sidebar__new-room"
        onClick={() => setPanel({ kind: 'createRoom' })}
      >
        {t('sidebar.newRoom')}
      </button>
    </aside>
  );
}

function InboxButton() {
  const { t } = useTranslation();
  const desks = useOffice((state) => state.desks);
  const setPanel = useOffice((state) => state.setPanel);
  const count = attentionDesks(desks).length;
  return (
    <button
      className={`button button--ghost inbox-button${count > 0 ? ' inbox-button--active' : ''}`}
      onClick={() => setPanel({ kind: 'inbox' })}
    >
      {t('inbox.button')}
      {count > 0 && <span className="badge">{count}</span>}
    </button>
  );
}

function ViewModeSwitch() {
  const { t } = useTranslation();
  const viewMode = useOffice((state) => state.viewMode);
  const setViewMode = useOffice((state) => state.setViewMode);
  return (
    <div className="segmented" role="group" aria-label={t('hud.viewMode')}>
      {(['overview', 'walk'] as const).map((mode) => (
        <button
          key={mode}
          className={`segmented__item${viewMode === mode ? ' segmented__item--active' : ''}`}
          onClick={() => setViewMode(mode)}
          aria-pressed={viewMode === mode}
          title={t(`hud.viewModes.${mode}.hint`)}
        >
          {t(`hud.viewModes.${mode}.label`)}
        </button>
      ))}
    </div>
  );
}

/** Crosshair and controls reminder in walk mode. */
function WalkHints() {
  const { t } = useTranslation();
  const viewMode = useOffice((state) => state.viewMode);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const onChange = () => setLocked(document.pointerLockElement !== null);
    document.addEventListener('pointerlockchange', onChange);
    return () => document.removeEventListener('pointerlockchange', onChange);
  }, []);
  if (viewMode !== 'walk') return null;
  return (
    <>
      {locked && <div className="crosshair" aria-hidden="true" />}
      <div className="walk-hints panel">{locked ? t('hud.walk.locked') : t('hud.walk.unlocked')}</div>
    </>
  );
}

function Dialogs() {
  const panel = useOffice((state) => state.panel);
  const setPanel = useOffice((state) => state.setPanel);
  if (!panel) return null;
  const close = () => setPanel(null);
  if (panel.kind === 'createRoom') return <CreateRoomDialog onClose={close} />;
  if (panel.kind === 'board') return <RoomBoardDialog roomId={panel.roomId} onClose={close} />;
  if (panel.kind === 'inbox') return <InboxPanel onClose={close} />;
  if (panel.kind === 'summary') return <SummaryPanel onClose={close} />;
  if (panel.kind === 'map') return <MapPanel onClose={close} />;
  if (panel.kind === 'timeline') return <TimelinePanel onClose={close} />;
  if (panel.kind === 'notifications') return <NotificationsDialog onClose={close} />;
  if (panel.kind === 'integrate') return <IntegrationDialog deskId={panel.deskId} onClose={close} />;
  return <CreateDeskDialog roomId={panel.roomId} onClose={close} />;
}
