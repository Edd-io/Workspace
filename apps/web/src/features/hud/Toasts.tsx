import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useOffice, type Toast } from '../../state/officeStore';
import { StateDot } from './StateBadge';

const TOAST_MS = 9000;

function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useTranslation();
  const desk = useOffice((state) => state.desks[toast.deskId]);
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
