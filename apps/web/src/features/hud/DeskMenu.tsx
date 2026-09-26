import type { Desk } from '@workspace/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/http';

export function DeskMenu({ desk, onClose }: { desk: Desk; onClose: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<'normal' | 'force' | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'uncommitted_changes') {
        setConfirmDelete('force');
        return;
      }
      setError(
        t(`errors.${caught instanceof ApiError ? caught.code : 'unknown_error'}`, {
          defaultValue: t('errors.unknown_error'),
        }),
      );
    }
  };

  const offline = desk.state === 'offline';
  return (
    <div className="desk-menu panel" role="menu">
      {offline ? (
        <button
          className="desk-menu__item"
          onClick={() => void run(() => api('POST', `/api/desks/${desk.id}/start`))}
        >
          {t('desk.actions.start')}
        </button>
      ) : (
        <>
          <button
            className="desk-menu__item"
            onClick={() => void run(() => api('POST', `/api/desks/${desk.id}/restart`))}
          >
            {t('desk.actions.restart')}
          </button>
          <button
            className="desk-menu__item"
            onClick={() => void run(() => api('POST', `/api/desks/${desk.id}/stop`))}
          >
            {t('desk.actions.stop')}
          </button>
        </>
      )}
      {confirmDelete === null ? (
        <button
          className="desk-menu__item desk-menu__item--danger"
          onClick={() => setConfirmDelete('normal')}
        >
          {t('desk.actions.delete')}
        </button>
      ) : (
        <div className="desk-menu__confirm">
          <p>
            {confirmDelete === 'force'
              ? t('desk.confirmDeleteUncommitted')
              : t('desk.confirmDelete', { branch: desk.branch ?? '' })}
          </p>
          <button
            className="button button--danger button--small"
            onClick={() =>
              void run(() =>
                api('DELETE', `/api/desks/${desk.id}${confirmDelete === 'force' ? '?force=1' : ''}`),
              )
            }
          >
            {t('desk.actions.confirmDelete')}
          </button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
