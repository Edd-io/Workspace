import { USAGE_WINDOWS } from '@workspace/shared';
import { useTranslation } from 'react-i18next';
import { useRelativeTime } from '../../lib/time';
import { useOffice } from '../../state/officeStore';
import { formatReset, usageLevel, WINDOW_LABEL_KEYS } from './usage';

/** Top bar gauge of the Claude subscription: 5-hour and weekly windows. */
export function UsageGauge() {
  const { t, i18n } = useTranslation();
  const usage = useOffice((state) => state.usage);
  const reported = useRelativeTime(usage?.reportedAt ?? null);
  if (!usage || (!usage.fiveHour && !usage.sevenDay)) return null;
  const language = i18n.resolvedLanguage ?? 'en';

  const details = USAGE_WINDOWS.flatMap((name) => {
    const window = usage[name];
    if (!window) return [];
    return [
      t('usage.windowDetail', {
        window: t(WINDOW_LABEL_KEYS[name]),
        percent: Math.round(window.usedPercentage),
        reset: formatReset(window, language),
      }),
    ];
  });
  const title = [t('usage.title'), ...details, t('usage.reported', { ago: reported })].join('\n');

  return (
    <div className="usage-gauge" title={title} aria-label={title}>
      {USAGE_WINDOWS.map((name) => {
        const window = usage[name];
        if (!window) return null;
        const percent = Math.round(window.usedPercentage);
        return (
          <span key={name} className={`usage-gauge__item usage-gauge__item--${usageLevel(percent)}`}>
            <span className="usage-gauge__label">{t(`${WINDOW_LABEL_KEYS[name]}Short`)}</span>
            <span className="usage-gauge__bar">
              <span style={{ width: `${Math.min(100, percent)}%` }} />
            </span>
            <span className="usage-gauge__value">{percent}%</span>
          </span>
        );
      })}
    </div>
  );
}
