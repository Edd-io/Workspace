import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { panelOnTop } from '../../state/officeStore';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

export function Dialog({ title, onClose, children, wide = false }: Props) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  // Take the keyboard (unless a field inside already has it, e.g. with autoFocus): otherwise it
  // stays where the dialog was opened from, such as the terminal, which keeps every key for itself.
  useEffect(() => {
    if (root.current && !root.current.contains(document.activeElement)) root.current.focus();
  }, []);
  // Escape closes the dialog wherever the focus is, unless a terminal was opened above it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panelOnTop()) onClose();
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
        ref={root}
        tabIndex={-1}
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
