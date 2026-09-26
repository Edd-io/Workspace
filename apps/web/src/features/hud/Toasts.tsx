import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useOffice, type Toast } from '../../state/officeStore';
import { formatReset, WINDOW_LABEL_KEYS } from '../usage/usage';
import { StateDot } from './StateBadge';

const TOAST_MS = 9000;

function UsageToast({ toast }: { toast: Extract<Toast, { usage: object }> }) {
  const { t, i18n } = useTranslation();
  const dismiss = useOffice((state) => state.dismissToast);
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), TOAST_MS * 2);
    return () => window.clearTimeout(timer);
  }, [dismiss, toast.id]);
  const { usage } = toast;
  return (
    <div className="toast toast--usage panel" role="status">
      <div className="toast__main">
        <span className="toast__icon" aria-hidden="true">
          ⚠️
        </span>
        <span>
          <strong>{t('usage.alert.title', { percent: Math.round(usage.usedPercentage) })}</strong>
          <span className="toast__text">
            {t('usage.alert.body', {
              window: t(WINDOW_LABEL_KEYS[usage.window]),
              reset: formatReset(usage, i18n.resolvedLanguage ?? 'en'),
            })}
          </span>
        </span>
      </div>
      <button
        className="button button--ghost button--small"
        onClick={() => dismiss(toast.id)}
        aria-label={t('common.close')}
      >
        ✕
      </button>
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  if (toast.usage) return <UsageToast toast={toast} />;
  return <DeskToast toast={toast} deskId={toast.deskId} />;
}

function DeskToast({ toast, deskId }: { toast: Toast; deskId: string }) {
  const { t } = useTranslation();
  const desk = useOffice((state) => state.desks[deskId]);
  const room = useOffice((state) => (desk ? state.rooms[desk.roomId] : undefined));
  const dismiss = useOffice((state) => state.dismissToast);
  const openTerminal = useOffice((state) => state.openTerminal);

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [dismiss, toast.id]);

  if (!desk) return null;
  return (
    <div className="toast panel" role="status">
      <button
        className="toast__main"
        onClick={() => {
          openTerminal(desk.id);
          dismiss(toast.id);
        }}
      >
        <StateDot state={desk.state} />
        <span>
          <strong>{t('notifications.title', { desk: desk.name, room: room?.name ?? '' })}</strong>
          {desk.attention?.text && <span className="toast__text">{desk.attention.text}</span>}
        </span>
      </button>
      <button
        className="button button--ghost button--small"
        onClick={() => dismiss(toast.id)}
        aria-label={t('common.close')}
      >
        ✕
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useOffice((state) => state.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
