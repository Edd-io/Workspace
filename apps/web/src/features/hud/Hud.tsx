import { ATTENTION_STATES, DESK_STATES, type DeskState } from '@workspace/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/http';
import { deskTopic } from '../../lib/desk';
import { desksOfRoom, sortedRooms, useOffice } from '../../state/officeStore';
import { RoomBoardDialog } from '../board/RoomBoardDialog';
import { CreateDeskDialog } from './CreateDeskDialog';
import { CreateRoomDialog } from './CreateRoomDialog';
import { DeskMenu } from './DeskMenu';
import { LanguageSwitcher } from './LanguageSwitcher';
import { StateDot } from './StateBadge';

export function Hud({ onLoggedOut }: { onLoggedOut: () => void }) {
  return (
    <>
      <TopBar onLoggedOut={onLoggedOut} />
      <OfficeSidebar />
      <Dialogs />
    </>
  );
}

function TopBar({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { t } = useTranslation();
  const connection = useOffice((state) => state.connection);
  const desks = useOffice((state) => state.desks);
  const counts = useMemo(() => {
    const result = new Map<DeskState, number>();
    for (const desk of Object.values(desks)) result.set(desk.state, (result.get(desk.state) ?? 0) + 1);
    return result;
  }, [desks]);

  const logout = async () => {
    await api('POST', '/api/auth/logout');
    onLoggedOut();
  };

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
      <div className="topbar__actions">
        <LanguageSwitcher />
        <button className="button button--ghost" onClick={() => void logout()}>
          {t('login.signOut')}
        </button>
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
  const [collapsed, setCollapsed] = useState(false);
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
                  <button className="sidebar-desk__main" onClick={() => openTerminal(desk.id)}>
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

function Dialogs() {
  const panel = useOffice((state) => state.panel);
  const setPanel = useOffice((state) => state.setPanel);
  if (!panel) return null;
  const close = () => setPanel(null);
  if (panel.kind === 'createRoom') return <CreateRoomDialog onClose={close} />;
  if (panel.kind === 'board') return <RoomBoardDialog roomId={panel.roomId} onClose={close} />;
  return <CreateDeskDialog roomId={panel.roomId} onClose={close} />;
}
