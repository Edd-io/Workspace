import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

export function Dialog({ title, onClose, children, wide = false }: Props) {
  const { t } = useTranslation();
  // Escape closes the dialog wherever the focus is.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className={`dialog panel${wide ? ' dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          // Keep office shortcuts away from form fields, but let Escape reach the close handler.
          if (event.key !== 'Escape') event.stopPropagation();
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
