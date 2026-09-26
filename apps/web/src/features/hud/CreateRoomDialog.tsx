import type { Room } from '@workspace/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/http';
import { Dialog } from './Dialog';

interface DirectoryListing {
  path: string;
  parent: string | null;
  isGitRepo: boolean;
  directories: { name: string; path: string; isGitRepo: boolean }[];
}

export function CreateRoomDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const browse = (path?: string) => {
    const query = path ? `?path=${encodeURIComponent(path)}` : '';
    api<DirectoryListing>('GET', `/api/fs/directories${query}`)
      .then(setListing)
      .catch(() => setError(t('errors.cannot_read_directory')));
  };

  useEffect(() => browse(), []);

  const folderName = listing?.path.split('/').filter(Boolean).at(-1) ?? '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!listing) return;
    setPending(true);
    setError(null);
    try {
      await api<Room>('POST', '/api/rooms', { name: name.trim() || folderName, projectPath: listing.path });
      onClose();
    } catch (caught) {
      setError(
        t(`errors.${caught instanceof ApiError ? caught.code : 'unknown_error'}`, {
          defaultValue: t('errors.unknown_error'),
        }),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog title={t('createRoom.title')} onClose={onClose}>
      <form className="dialog__form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">{t('createRoom.name')}</span>
          <input
            className="input"
            autoFocus
            value={name}
            placeholder={folderName}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="field">
          <span className="field__label">{t('createRoom.project')}</span>
          <div className="dir-browser">
            <div className="dir-browser__path">
              <code>{listing?.path ?? '…'}</code>
              {listing?.isGitRepo && <span className="tag">git</span>}
            </div>
            <ul className="dir-browser__list">
              {listing?.parent && (
                <li>
                  <button type="button" onClick={() => browse(listing.parent!)}>
                    ↑ {t('createRoom.parent')}
                  </button>
                </li>
              )}
              {listing?.directories.map((directory) => (
                <li key={directory.path}>
                  <button type="button" onClick={() => browse(directory.path)}>
                    📁 {directory.name}
                    {directory.isGitRepo && <span className="tag">git</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p className="field__hint">{t('createRoom.hint')}</p>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={pending || !listing || (name.trim() === '' && folderName === '')}
          >
            {t('createRoom.submit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
