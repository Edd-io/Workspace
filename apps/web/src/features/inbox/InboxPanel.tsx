import type { Desk } from '@workspace/shared';
import { useTranslation } from 'react-i18next';
import { useRelativeTime } from '../../lib/time';
import { attentionDesks, useOffice } from '../../state/officeStore';
import { Dialog } from '../hud/Dialog';
import { StateBadge } from '../hud/StateBadge';

function InboxItem({ desk }: { desk: Desk }) {
  const { t } = useTranslation();
  const room = useOffice((state) => state.rooms[desk.roomId]);
  const openTerminal = useOffice((state) => state.openTerminal);
  const since = useRelativeTime(desk.stateSince);
  return (
    <li>
      <button className="inbox-item" onClick={() => openTerminal(desk.id)}>
        <div className="inbox-item__header">
          <strong>{desk.name}</strong>
          <span className="muted">{room?.name}</span>
          <StateBadge state={desk.state} />
          <span className="muted inbox-item__since">{since}</span>
        </div>
        {desk.attention && (
          <div className="inbox-item__body">
            <span className="tag">{t(`attention.${desk.attention.kind}`)}</span>
            {desk.attention.text && <span>{desk.attention.text}</span>}
          </div>
        )}
        <span className="inbox-item__action">{t('inbox.answer')}</span>
      </button>
    </li>
  );
}

/** Every desk waiting for the human, answerable without walking to its room. */
export function InboxPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const desks = useOffice((state) => state.desks);
  const waiting = attentionDesks(desks);
  return (
    <Dialog title={t('inbox.title')} onClose={onClose} wide>
      {waiting.length === 0 ? (
        <p className="muted">{t('inbox.empty')}</p>
      ) : (
        <ul className="inbox">
          {waiting.map((desk) => (
            <InboxItem key={desk.id} desk={desk} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
