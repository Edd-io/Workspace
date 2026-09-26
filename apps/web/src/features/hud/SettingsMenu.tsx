import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/http';
import { GRAPHICS_QUALITIES, setGraphicsQuality, useGraphicsQuality } from '../../world/graphicsSettings';
import { browserNotificationsEnabled, setBrowserNotifications } from '../notifications/useAttentionAlerts';
import {
  onSoundEnabledChange,
  onSoundVolumeChange,
  setSoundEnabled,
  setSoundVolume,
  SOUND_CATEGORIES,
  soundEnabled,
  soundVolume,
} from '../sound/soundSettings';
import { useOffice } from '../../state/officeStore';
import { LanguageSwitcher } from './LanguageSwitcher';

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="segmented" role="group" aria-label={label}>
      {[true, false].map((option) => (
        <button
          key={String(option)}
          className={`segmented__item${value === option ? ' segmented__item--active' : ''}`}
          onClick={() => onChange(option)}
          aria-pressed={value === option}
        >
          {option ? t('settings.on') : t('settings.off')}
        </button>
      ))}
    </div>
  );
}

/** Viewer preferences (graphics, sound, notifications, language) and sign-out, behind one button. */
export function SettingsMenu({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const quality = useGraphicsQuality();
  const [sound, setSound] = useState(soundEnabled);
  const [notifications, setNotifications] = useState(browserNotificationsEnabled);
  const [volumes, setVolumes] = useState(() => ({
    ambience: soundVolume('ambience'),
    steps: soundVolume('steps'),
  }));
  useEffect(() => onSoundEnabledChange(setSound), []);
  useEffect(() => onSoundVolumeChange(setVolumes), []);

  // Closes on a click elsewhere or on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const logout = async () => {
    await api('POST', '/api/auth/logout');
    onLoggedOut();
  };

  return (
    <div className="settings" ref={root}>
      <button
        className={`button button--ghost button--icon${open ? ' button--on' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={t('settings.title')}
        title={t('settings.title')}
      >
        ⚙️
      </button>
      {open && (
        <div className="settings__menu panel" role="dialog" aria-label={t('settings.title')}>
          <div className="settings__row">
            <span className="settings__label">{t('settings.graphics')}</span>
            <div className="segmented" role="group" aria-label={t('settings.graphics')}>
              {GRAPHICS_QUALITIES.map((level) => (
                <button
                  key={level}
                  className={`segmented__item${quality === level ? ' segmented__item--active' : ''}`}
                  onClick={() => setGraphicsQuality(level)}
                  aria-pressed={quality === level}
                >
                  {t(`graphics.levels.${level}`)}
                </button>
              ))}
            </div>
            <span className="settings__hint">{t(`graphics.descriptions.${quality}`)}</span>
          </div>
          <div className="settings__row">
            <span className="settings__label">{t('settings.sound')}</span>
            <Toggle value={sound} onChange={setSoundEnabled} label={t('settings.sound')} />
            {sound &&
              SOUND_CATEGORIES.map((category) => (
                <label key={category} className="settings__slider">
                  <span>{t(`settings.volumes.${category}`)}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(volumes[category] * 100)}
                    onChange={(event) => setSoundVolume(category, Number(event.target.value) / 100)}
                  />
                </label>
              ))}
          </div>
          <div className="settings__row">
            <span className="settings__label">{t('settings.notifications')}</span>
            <Toggle
              value={notifications}
              onChange={(next) => void setBrowserNotifications(next).then(setNotifications)}
              label={t('settings.notifications')}
            />
          </div>
          <button
            className="button settings__logout"
            onClick={() => {
              setOpen(false);
              useOffice.getState().setPanel({ kind: 'notifications' });
            }}
          >
            {t('phoneNotifications.menu')}
          </button>
          <div className="settings__row">
            <span className="settings__label">{t('hud.language')}</span>
            <LanguageSwitcher />
          </div>
          <button className="button settings__logout" onClick={() => void logout()}>
            {t('login.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
