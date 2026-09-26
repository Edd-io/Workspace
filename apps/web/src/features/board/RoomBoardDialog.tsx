import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/http';
import { deskTopic } from '../../lib/desk';
import { desksOfRoom, useOffice } from '../../state/officeStore';
import { Dialog } from '../hud/Dialog';
import { StateDot } from '../hud/StateBadge';

export function RoomBoardDialog({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const room = useOffice((state) => state.rooms[roomId]);
  const board = useOffice((state) => state.boards[roomId]);
  const allDesks = useOffice((state) => state.desks);
  const openTerminal = useOffice((state) => state.openTerminal);
  const desks = desksOfRoom(allDesks, roomId);
  const [message, setMessage] = useState('');
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!room) return null;

  const deskName = (deskId: string | null) =>
    deskId ? (allDesks[deskId]?.name ?? t('board.formerDesk')) : t('whiteboard.human');
  const time = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString(i18n.resolvedLanguage, { hour: '2-digit', minute: '2-digit' });

  const run = async (action: () => Promise<unknown>, reset: () => void) => {
    setError(null);
    try {
      await action();
      reset();
    } catch (caught) {
      setError(
        t(`errors.${caught instanceof ApiError ? caught.code : 'unknown_error'}`, {
          defaultValue: t('errors.unknown_error'),
        }),
      );
    }
  };

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    void run(
      () =>
        api('POST', `/api/rooms/${roomId}/messages`, { body: message.trim(), toDeskId: recipient || null }),
      () => setMessage(''),
    );
  };

  const pinNote = (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim()) return;
    void run(
      () => api('POST', `/api/rooms/${roomId}/notes`, { body: note.trim() }),
      () => setNote(''),
    );
  };

  const removeNote = (noteId: number) =>
    void run(
      () => api('DELETE', `/api/rooms/${roomId}/notes/${noteId}`),
      () => undefined,
    );

  return (
    <Dialog title={t('whiteboard.title', { room: room.name })} onClose={onClose} wide>
      <div className="board">
        <section className="board__section">
          <h3>{t('whiteboard.whoDoesWhat')}</h3>
          {desks.length === 0 && <p className="muted">{t('whiteboard.nobody')}</p>}
          <ul className="board__desks">
            {desks.map((desk) => (
              <li key={desk.id}>
                <button className="board__desk" onClick={() => openTerminal(desk.id)}>
                  <StateDot state={desk.state} />
                  <strong>{desk.name}</strong>
                  <span className="muted">{deskTopic(desk) ?? t(`states.${desk.state}`)}</span>
                </button>
              </li>
            ))}
          </ul>

          <h3>{t('whiteboard.notes')}</h3>
          {(board?.notes.length ?? 0) === 0 && <p className="muted">{t('whiteboard.noNotes')}</p>}
          <ul className="board__notes">
            {board?.notes.map((entry) => (
              <li key={entry.id}>
                <span className="board__note-body">{entry.body}</span>
                <span className="muted board__meta">{deskName(entry.deskId)}</span>
                <button
                  className="button button--ghost button--small"
                  onClick={() => removeNote(entry.id)}
                  aria-label={t('board.removeNote')}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <form className="board__form" onSubmit={pinNote}>
            <input
              className="input"
              value={note}
              placeholder={t('board.notePlaceholder')}
              onChange={(event) => setNote(event.target.value)}
            />
            <button className="button" type="submit" disabled={!note.trim()}>
              {t('board.pin')}
            </button>
          </form>
        </section>

        <section className="board__section">
          <h3>{t('whiteboard.messages')}</h3>
          <ol className="board__messages">
            {(board?.messages.length ?? 0) === 0 && <li className="muted">{t('board.noMessages')}</li>}
            {board?.messages.map((entry) => (
              <li key={entry.id}>
                <div className="board__meta">
                  <strong>{deskName(entry.fromDeskId)}</strong> →{' '}
                  {entry.toDeskId ? deskName(entry.toDeskId) : t('whiteboard.room')}
                  <span className="muted"> · {time(entry.createdAt)}</span>
                </div>
                <p>{entry.body}</p>
              </li>
            ))}
          </ol>
          <form className="board__form board__form--message" onSubmit={sendMessage}>
            <select
              className="input"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            >
              <option value="">{t('board.toRoom')}</option>
              {desks.map((desk) => (
                <option key={desk.id} value={desk.id}>
                  {desk.name}
                </option>
              ))}
            </select>
            <textarea
              className="input"
              rows={2}
              value={message}
              placeholder={t('board.messagePlaceholder')}
              onChange={(event) => setMessage(event.target.value)}
            />
            <button className="button button--primary" type="submit" disabled={!message.trim()}>
              {t('board.send')}
            </button>
          </form>
          <p className="field__hint">{t('board.deliveryHint')}</p>
        </section>
      </div>
      {error && <p className="form-error">{error}</p>}
    </Dialog>
  );
}
