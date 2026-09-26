import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ title, onClose, children }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="dialog panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
        }}
      >
        <header className="dialog__header">
          <h2>{title}</h2>
          <button
            className="button button--ghost button--small"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
