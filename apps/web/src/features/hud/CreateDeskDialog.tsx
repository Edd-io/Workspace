import { PERMISSION_MODES, type Desk, type DeskMode, type PermissionMode } from '@workspace/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/http';
import { useOffice } from '../../state/officeStore';
import { ROLE_IDS, roleText } from '../rooms/roomTemplates';
import { Dialog } from './Dialog';

const MODELS = ['', 'opus', 'sonnet', 'haiku'] as const;

export function CreateDeskDialog({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const room = useOffice((state) => state.rooms[roomId]);
  const openTerminal = useOffice((state) => state.openTerminal);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<DeskMode>(room?.isGitRepo ? 'worktree' : 'shared');
  const [model, setModel] = useState<(typeof MODELS)[number]>('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode | ''>('');
  const [initialPrompt, setInitialPrompt] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!room) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const desk = await api<Desk>('POST', '/api/desks', {
        roomId,
        mode,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(model ? { model } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(initialPrompt.trim() ? { initialPrompt: initialPrompt.trim() } : {}),
        ...(role.trim() ? { role: role.trim() } : {}),
      });
      onClose();
      openTerminal(desk.id);
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
    <Dialog title={t('createDesk.title', { room: room.name })} onClose={onClose}>
      <form className="dialog__form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">{t('createDesk.name')}</span>
          <input
            className="input"
            autoFocus
            value={name}
            placeholder={t('createDesk.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="field">
          <span className="field__label">{t('createDesk.mode')}</span>
          <div className="radio-cards">
            {(['worktree', 'shared'] as const).map((option) => (
              <label
                key={option}
                className={`radio-card${mode === option ? ' radio-card--active' : ''}${
                  option === 'worktree' && !room.isGitRepo ? ' radio-card--disabled' : ''
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value={option}
                  checked={mode === option}
                  disabled={option === 'worktree' && !room.isGitRepo}
                  onChange={() => setMode(option)}
                />
                <strong>{t(`createDesk.modes.${option}.label`)}</strong>
                <span className="muted">{t(`createDesk.modes.${option}.description`)}</span>
              </label>
            ))}
          </div>
          {!room.isGitRepo && <p className="field__hint">{t('createDesk.notGit')}</p>}
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field__label">{t('createDesk.model')}</span>
            <select
              className="input"
              value={model}
              onChange={(event) => setModel(event.target.value as (typeof MODELS)[number])}
            >
              {MODELS.map((option) => (
                <option key={option} value={option}>
                  {option ? option : t('createDesk.defaultOption')}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{t('createDesk.permissionMode')}</span>
            <select
              className="input"
              value={permissionMode}
              onChange={(event) => setPermissionMode(event.target.value as PermissionMode | '')}
            >
              <option value="">{t('createDesk.defaultOption')}</option>
              {PERMISSION_MODES.map((option) => (
                <option key={option} value={option}>
                  {t(`permissionModes.${option}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="desk-role">
            {t('createDesk.role')}
          </label>
          <input
            id="desk-role"
            className="input"
            value={role}
            placeholder={t('createDesk.rolePlaceholder')}
            onChange={(event) => setRole(event.target.value)}
          />
          <span className="role-chips">
            {ROLE_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className="tag role-chip"
                onClick={() => setRole(roleText(t, id))}
              >
                {t(`roles.${id}.label`)}
              </button>
            ))}
          </span>
        </div>
        <label className="field">
          <span className="field__label">{t('createDesk.initialPrompt')}</span>
          <textarea
            className="input"
            rows={4}
            value={initialPrompt}
            placeholder={t('createDesk.initialPromptPlaceholder')}
            onChange={(event) => setInitialPrompt(event.target.value)}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="button button--primary" disabled={pending}>
            {pending ? t('createDesk.creating') : t('createDesk.submit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
