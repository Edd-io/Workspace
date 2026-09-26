import type { SearchResult } from '@workspace/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/http';
import { sortedRooms, useOffice } from '../../state/officeStore';
import { Dialog } from '../hud/Dialog';

const DEBOUNCE_MS = 300;
const MIN_LENGTH = 2;

/** Searches every desk's conversation (prompts and answers). */
export function SearchDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const rooms = useOffice((state) => state.rooms);
  const desks = useOffice((state) => state.desks);
  const openTerminal = useOffice((state) => state.openTerminal);
  const [query, setQuery] = useState('');
  const [roomId, setRoomId] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_LENGTH) {
      setResult(null);
      setLoading(false);
      return;
    }
    const request = ++latest.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q, ...(roomId ? { roomId } : {}) });
      api<SearchResult>('GET', `/api/search?${params.toString()}`)
        .then((next) => {
          if (request !== latest.current) return;
          setResult(next);
          setFailed(false);
        })
        .catch(() => request === latest.current && setFailed(true))
        .finally(() => request === latest.current && setLoading(false));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, roomId]);

  const format = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const hits = result?.hits.filter((hit) => desks[hit.deskId]) ?? [];

  return (
    <Dialog title={t('search.title')} onClose={onClose} wide>
      <div className="search">
        <div className="search__bar">
          <input
            className="input"
            autoFocus
            value={query}
            placeholder={t('search.placeholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            className="input search__room"
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
          >
            <option value="">{t('search.allRooms')}</option>
            {sortedRooms(rooms).map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </div>
        <p className="muted search__status">
          {query.trim().length < MIN_LENGTH
            ? t('search.hint')
            : loading
              ? t('search.searching')
              : failed
                ? t('errors.unknown_error')
                : result && hits.length === 0
                  ? t('search.none')
                  : result &&
                    t(result.truncated ? 'search.countTruncated' : 'search.count', { count: hits.length })}
        </p>
        <ul className="inbox search__results">
          {hits.map((hit, index) => {
            const desk = desks[hit.deskId]!;
            const room = rooms[desk.roomId];
            return (
              <li key={`${hit.deskId}-${hit.ts}-${index}`}>
                <button
                  className="inbox-item"
                  onClick={() => {
                    openTerminal(hit.deskId);
                    onClose();
                  }}
                >
                  <span className="inbox-item__header">
                    {room && (
                      <span className="sidebar-room__swatch" style={{ background: room.accentColor }} />
                    )}
                    <strong>{desk.name}</strong>
                    <span className="tag">{hit.role === 'user' ? t('search.you') : t('search.answer')}</span>
                    <span className="inbox-item__since muted">{format.format(hit.ts)}</span>
                  </span>
                  <span className="search__snippet">
                    {hit.before}
                    <mark>{hit.match}</mark>
                    {hit.after}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}
