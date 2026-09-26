import { NOTIFICATION_EVENTS, type NotificationSettings } from '@workspace/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/http';
import { currentLanguage } from '../../i18n';
import { useRelativeTime } from '../../lib/time';
import { Dialog } from '../hud/Dialog';

/** Phone notifications through a Discord webhook. */
export function NotificationsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [webhook, setWebhook] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [pending, setPending] = useState<'save' | 'test' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const lastSent = useRelativeTime(settings?.lastSentAt ?? null);

  useEffect(() => {
    api<NotificationSettings>('GET', '/api/notifications')
      .then((next) => {
        setSettings(next);
        setPublicUrl(next.publicUrl ?? window.location.origin);
      })
      .catch(() => setMessage({ tone: 'error', text: t('errors.unknown_error') }));
  }, [t]);

  if (!settings) {
    return (
      <Dialog title={t('phoneNotifications.title')} onClose={onClose}>
        <p className="muted">{t('integration.loading')}</p>
      </Dialog>
    );
  }

  const update = async (patch: Record<string, unknown>, optimistic?: Partial<NotificationSettings>) => {
    setMessage(null);
    if (optimistic) setSettings({ ...settings, ...optimistic });
    try {
      setSettings(await api<NotificationSettings>('PATCH', '/api/notifications', patch));
      return true;
    } catch (error) {
      setMessage({
        tone: 'error',
        text: t(`phoneNotifications.errors.${error instanceof ApiError ? error.code : 'unknown_error'}`, {
          defaultValue: t('phoneNotifications.errors.invalid_input'),
        }),
      });
      if (optimistic) setSettings(settings);
      return false;
    }
  };

  const save = async () => {
    setPending('save');
    const ok = await update({
      ...(webhook.trim() ? { webhook: webhook.trim() } : {}),
      publicUrl: publicUrl.trim() || null,
      language: currentLanguage(),
    });
    if (ok) {
      setWebhook('');
      setMessage({ tone: 'success', text: t('phoneNotifications.saved') });
    }
    setPending(null);
  };

  const test = async () => {
    setPending('test');
    setMessage(null);
    try {
      const next = await api<NotificationSettings>('POST', '/api/notifications/test');
      setSettings(next);
      setMessage(
        next.lastError
          ? { tone: 'error', text: t('phoneNotifications.testFailed', { error: next.lastError }) }
          : { tone: 'success', text: t('phoneNotifications.testSent') },
      );
    } catch {
      setMessage({ tone: 'error', text: t('phoneNotifications.errors.no_webhook') });
    }
    setPending(null);
  };

  return (
    <Dialog title={t('phoneNotifications.title')} onClose={onClose}>
      <div className="dialog__form">
        <p className="muted">{t('phoneNotifications.intro')}</p>
        <ol className="notifications-steps muted">
          <li>{t('phoneNotifications.steps.channel')}</li>
          <li>{t('phoneNotifications.steps.webhook')}</li>
          <li>{t('phoneNotifications.steps.paste')}</li>
        </ol>
        <label className="field">
          <span className="field__label">{t('phoneNotifications.webhook')}</span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            value={webhook}
            placeholder={
              settings.webhookSet
                ? t('phoneNotifications.webhookSet', { hint: settings.webhookHint })
                : 'https://discord.com/api/webhooks/…'
            }
            onChange={(event) => setWebhook(event.target.value)}
          />
          {settings.webhookSet && (
            <button
              type="button"
              className="button button--ghost button--small notifications-remove"
              onClick={() => void update({ webhook: null })}
            >
              {t('phoneNotifications.removeWebhook')}
            </button>
          )}
        </label>
        <div className="field">
          <span className="field__label">{t('phoneNotifications.events')}</span>
          {NOTIFICATION_EVENTS.map((event) => (
            <label key={event} className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.events[event]}
                onChange={(change) => {
                  const events = { ...settings.events, [event]: change.target.checked };
                  void update({ events }, { events });
                }}
              />
              {t(`phoneNotifications.eventLabels.${event}`)}
            </label>
          ))}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.hideContent}
              onChange={(change) => {
                const hideContent = change.target.checked;
                void update({ hideContent }, { hideContent });
              }}
            />
            {t('phoneNotifications.hideContent')}
          </label>
          <span className="field__hint">{t('phoneNotifications.whenAway')}</span>
        </div>
        <label className="field">
          <span className="field__label">{t('phoneNotifications.publicUrl')}</span>
          <input className="input" value={publicUrl} onChange={(event) => setPublicUrl(event.target.value)} />
          <span className="field__hint">{t('phoneNotifications.publicUrlHint')}</span>
        </label>
        {settings.lastSentAt && !message && (
          <p className="field__hint">{t('phoneNotifications.lastSent', { ago: lastSent })}</p>
        )}
        {settings.lastError && !message && (
          <p className="form-error">{t('phoneNotifications.testFailed', { error: settings.lastError })}</p>
        )}
        {message && (
          <p className={message.tone === 'error' ? 'form-error' : 'integration__success'}>{message.text}</p>
        )}
        <div className="dialog__actions">
          <button
            className="button"
            disabled={!settings.webhookSet || pending !== null}
            onClick={() => void test()}
          >
            {t('phoneNotifications.test')}
          </button>
          <button className="button button--primary" disabled={pending !== null} onClick={() => void save()}>
            {t('phoneNotifications.save')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
