import type { FramePicture } from '@workspace/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/http';
import { modKey } from '../../lib/platform';
import { picturesById, useOffice } from '../../state/officeStore';
import { Dialog } from '../hud/Dialog';
import { preparePicture } from './preparePicture';

type Failure = 'not_image' | 'upload_failed';

/** Puts a picture in one of the office's frames: pick a file, drop it or paste it. */
export function FrameDialog({
  frameId,
  aspect,
  onClose,
}: {
  frameId: string;
  aspect: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const url = useOffice((state) => state.pictures[frameId]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (file: Blob) => {
    setBusy(true);
    setFailure(null);
    try {
      let picture: Blob;
      try {
        picture = await preparePicture(file);
      } catch {
        setFailure('not_image');
        return;
      }
      const response = await fetch(`/api/pictures/${frameId}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': picture.type },
        body: picture,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      useOffice.setState({ pictures: picturesById((await response.json()) as FramePicture[]) });
    } catch {
      setFailure('upload_failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const pictures = await api<FramePicture[]>('DELETE', `/api/pictures/${frameId}`);
      useOffice.setState({ pictures: picturesById(pictures) });
    } catch {
      setFailure('upload_failed');
    } finally {
      setBusy(false);
    }
  };

  // Pasting an image anywhere while the dialog is open puts it in the frame.
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith('image/'));
      if (!file) return;
      event.preventDefault();
      void uploadRef.current(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const choose = () => input.current?.click();

  return (
    <Dialog title={t('frames.title')} onClose={onClose}>
      <div className="dialog__form">
        <div
          className={`frame-preview${dragging ? ' frame-preview--drop' : ''}`}
          style={{ aspectRatio: aspect, width: `min(100%, ${Math.round(44 * aspect)}vh)` }}
          role="button"
          tabIndex={0}
          aria-label={url ? t('frames.replace') : t('frames.choose')}
          onClick={choose}
          onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && choose()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) void upload(file);
          }}
        >
          {url ? (
            <img src={url} alt="" />
          ) : (
            <span className="frame-preview__empty">{t('frames.drop', { shortcut: modKey('V') })}</span>
          )}
          {busy && <span className="frame-preview__busy">{t('frames.uploading')}</span>}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
        <p className="field__hint">{t('frames.hint')}</p>
        {failure && <p className="form-error">{t(`frames.errors.${failure}`)}</p>}
        <div className="dialog__actions">
          {url && (
            <button className="button" disabled={busy} onClick={() => void remove()}>
              {t('frames.remove')}
            </button>
          )}
          <button className="button button--primary" disabled={busy} onClick={choose}>
            {url ? t('frames.replace') : t('frames.choose')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
