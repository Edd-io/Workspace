import { STATS_PERIODS, type DeskPeriodStats, type OfficeStats, type StatsPeriod } from '@workspace/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/http';
import { useOffice } from '../../state/officeStore';

const REFRESH_MS = 60_000;

type Column =
  | 'workingMs'
  | 'waitingMs'
  | 'prompts'
  | 'toolCalls'
  | 'lines'
  | 'outputTokens'
  | 'contextTokens'
  | 'integrations';

const COLUMNS: Column[] = [
  'workingMs',
  'waitingMs',
  'prompts',
  'toolCalls',
  'lines',
  'outputTokens',
  'contextTokens',
  'integrations',
];

function sortValue(stats: DeskPeriodStats, column: Column): number {
  if (column === 'lines') return stats.linesAdded + stats.linesRemoved;
  if (column === 'integrations') return stats.merges + stats.pullRequests;
  return stats[column] ?? -1;
}

function active(stats: DeskPeriodStats): boolean {
  return stats.workingMs > 0 || stats.prompts > 0 || stats.toolCalls > 0 || stats.outputTokens > 0;
}

/** What each desk did over the last day, week or month. */
export function StatsView() {
  const { t, i18n } = useTranslation();
  const rooms = useOffice((state) => state.rooms);
  const desks = useOffice((state) => state.desks);
  const deskStats = useOffice((state) => state.deskStats);
  const openTerminal = useOffice((state) => state.openTerminal);
  const [period, setPeriod] = useState<StatsPeriod>('day');
  const [stats, setStats] = useState<OfficeStats | null>(null);
  const [sort, setSort] = useState<Column>('workingMs');

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    const load = () =>
      api<OfficeStats>('GET', `/api/stats?period=${period}`)
        .then((next) => !cancelled && setStats(next))
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [period]);

  const language = i18n.resolvedLanguage ?? 'en';
  const compact = new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 });
  const number = new Intl.NumberFormat(language);
  const duration = (ms: number) => {
    const minutes = Math.round(ms / 60_000);
    if (minutes === 0) return ms > 0 ? t('stats.lessThanMinute') : '—';
    const hours = Math.floor(minutes / 60);
    return hours > 0
      ? t('stats.hoursMinutes', { hours, minutes: String(minutes % 60).padStart(2, '0') })
      : t('stats.minutes', { count: minutes });
  };

  const rows = (stats?.desks ?? [])
    .filter((entry) => desks[entry.deskId] && active(entry))
    .sort((a, b) => sortValue(b, sort) - sortValue(a, sort));
  const idle = (stats?.desks.filter((entry) => desks[entry.deskId]).length ?? 0) - rows.length;
  const total = (pick: (entry: DeskPeriodStats) => number) =>
    rows.reduce((sum, entry) => sum + pick(entry), 0);
  const maxWorking = Math.max(1, ...rows.map((entry) => entry.workingMs));

  const cards: { label: string; value: string; hint?: string }[] = [
    { label: t('stats.columns.workingMs'), value: duration(total((entry) => entry.workingMs)) },
    { label: t('stats.columns.waitingMs'), value: duration(total((entry) => entry.waitingMs)) },
    { label: t('stats.columns.prompts'), value: number.format(total((entry) => entry.prompts)) },
    {
      label: t('stats.columns.lines'),
      value: `+${compact.format(total((entry) => entry.linesAdded))} −${compact.format(total((entry) => entry.linesRemoved))}`,
    },
    { label: t('stats.columns.outputTokens'), value: compact.format(total((entry) => entry.outputTokens)) },
    {
      label: t('stats.teamwork'),
      value: `${number.format(total((entry) => entry.wakes))} · ${number.format(total((entry) => entry.delegations))}`,
      hint: t('stats.teamworkHint'),
    },
    {
      label: t('stats.columns.integrations'),
      value: `${number.format(total((entry) => entry.merges))} · ${number.format(total((entry) => entry.pullRequests))}`,
      hint: t('stats.integrationsHint'),
    },
    { label: t('stats.compactions'), value: number.format(total((entry) => entry.compactions)) },
  ];

  const cell = (entry: DeskPeriodStats, column: Column) => {
    switch (column) {
      case 'workingMs':
        return (
          <span className="stats__working">
            <span className="stats__track">
              <span className="stats__bar" style={{ width: `${(entry.workingMs / maxWorking) * 100}%` }} />
            </span>
            <span>{duration(entry.workingMs)}</span>
          </span>
        );
      case 'waitingMs':
        return duration(entry.waitingMs);
      case 'lines':
        return entry.linesAdded + entry.linesRemoved === 0 ? (
          '—'
        ) : (
          <>
            <span className="stats__added">+{number.format(entry.linesAdded)}</span>{' '}
            <span className="stats__removed">−{number.format(entry.linesRemoved)}</span>
          </>
        );
      case 'outputTokens':
        return entry.outputTokens ? compact.format(entry.outputTokens) : '—';
      case 'contextTokens': {
        // One unit for the whole column: tokens (from the transcript), the share of the window
        // (from the status line) as a tooltip when known.
        const percent = deskStats[entry.deskId]?.contextPercent;
        const share = percent === null || percent === undefined ? undefined : `${Math.round(percent)} %`;
        if (entry.contextTokens) return <span title={share}>{compact.format(entry.contextTokens)}</span>;
        return share ?? '—';
      }
      case 'integrations':
        return entry.merges + entry.pullRequests === 0
          ? '—'
          : `${number.format(entry.merges)} · ${number.format(entry.pullRequests)}`;
      default:
        return entry[column] ? number.format(entry[column]) : '—';
    }
  };

  return (
    <div className="stats">
      <div className="timeline__toolbar">
        <div className="segmented" role="group" aria-label={t('timeline.range')}>
          {STATS_PERIODS.map((option) => (
            <button
              key={option}
              className={`segmented__item${period === option ? ' segmented__item--active' : ''}`}
              onClick={() => setPeriod(option)}
            >
              {t(`stats.periods.${option}`)}
            </button>
          ))}
        </div>
        <span className="muted">{t('stats.hint')}</span>
      </div>
      {!stats && <p className="muted">{t('app.loading')}</p>}
      {stats && rows.length === 0 && <p className="muted">{t('timeline.empty')}</p>}
      {stats && rows.length > 0 && (
        <>
          <div className="stats__cards">
            {cards.map((card) => (
              <div key={card.label} className="stats__card" title={card.hint}>
                <span className="stats__value">{card.value}</span>
                <span className="stats__label muted">{card.label}</span>
              </div>
            ))}
          </div>
          <div className="stats__table-wrap">
            <table className="stats__table">
              <thead>
                <tr>
                  <th>{t('stats.columns.desk')}</th>
                  {COLUMNS.map((column) => (
                    <th key={column} title={t(`stats.columnHints.${column}`)}>
                      <button
                        className={`stats__sort${sort === column ? ' stats__sort--active' : ''}`}
                        onClick={() => setSort(column)}
                      >
                        {t(`stats.columns.${column}`)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => {
                  const desk = desks[entry.deskId]!;
                  const room = rooms[desk.roomId];
                  return (
                    <tr key={entry.deskId} onClick={() => openTerminal(entry.deskId)}>
                      <td>
                        <span className="stats__desk">
                          {room && (
                            <span className="sidebar-room__swatch" style={{ background: room.accentColor }} />
                          )}
                          <strong>{desk.name}</strong>
                          {room && <span className="muted">{room.name}</span>}
                        </span>
                      </td>
                      {COLUMNS.map((column) => (
                        <td key={column}>{cell(entry, column)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {idle > 0 && <p className="muted stats__idle">{t('stats.idleDesks', { count: idle })}</p>}
        </>
      )}
    </div>
  );
}
