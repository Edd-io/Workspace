import { DESK_STATE_COLORS, type DeskState } from '@workspace/shared';
import { useTranslation } from 'react-i18next';

export function StateDot({ state }: { state: DeskState }) {
  return (
    <span
      className={`state-dot state-dot--${state}`}
      style={{ '--state-color': DESK_STATE_COLORS[state] } as React.CSSProperties}
    />
  );
}

export function StateBadge({ state }: { state: DeskState }) {
  const { t } = useTranslation();
  return (
    <span className="state-badge">
      <StateDot state={state} />
      {t(`states.${state}`)}
    </span>
  );
}
