import { ATTENTION_STATES, type DeskState } from '@workspace/shared';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { onUsageAlert, useOffice } from '../../state/officeStore';
import { formatReset, WINDOW_LABEL_KEYS } from '../usage/usage';
import { playChime } from '../sound/chime';

const PREFERENCE_KEY = 'workspace.browserNotifications';

export function browserNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(PREFERENCE_KEY) === 'on' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

export async function setBrowserNotifications(enabled: boolean): Promise<boolean> {
  try {
    if (enabled && Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;
    }
    localStorage.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off');
    return enabled;
  } catch {
    return false;
  }
}

/**
 * When a desk starts waiting for the human (question, error, usage limit): in-app toast, a soft
 * chime, and a browser notification if enabled and the tab is not visible.
 */
export function useAttentionAlerts(): void {
  const { t, i18n } = useTranslation();

  // Subscription usage crossing 80 % / 95 % of a window (sent once per window by the server).
  useEffect(
    () =>
      onUsageAlert((alert) => {
        useOffice.getState().pushUsageToast(alert);
        playChime('question');
        if (browserNotificationsEnabled() && document.visibilityState !== 'visible') {
          new Notification(t('usage.alert.title', { percent: Math.round(alert.usedPercentage) }), {
            body: t('usage.alert.body', {
              window: t(WINDOW_LABEL_KEYS[alert.window]),
              reset: formatReset(alert, i18n.resolvedLanguage ?? 'en'),
            }),
            tag: `usage-${alert.window}`,
          });
        }
      }),
    [t, i18n.resolvedLanguage],
  );

  useEffect(() => {
    const previous = new Map<string, DeskState>();
    let initialized = false;
    return useOffice.subscribe((state) => {
      if (!state.loaded) return;
      for (const desk of Object.values(state.desks)) {
        const before = previous.get(desk.id);
        previous.set(desk.id, desk.state);
        if (!initialized || before === undefined) continue;
        if (!ATTENTION_STATES.has(desk.state) || ATTENTION_STATES.has(before)) continue;
        state.pushToast(desk.id);
        playChime(desk.state === 'error' ? 'error' : 'question');
        if (browserNotificationsEnabled() && document.visibilityState !== 'visible') {
          const room = state.rooms[desk.roomId];
          const notification = new Notification(
            t('notifications.title', { desk: desk.name, room: room?.name ?? '' }),
            {
              body: desk.attention?.text || t(`states.${desk.state}`),
              tag: `desk-${desk.id}`,
            },
          );
          notification.onclick = () => {
            window.focus();
            useOffice.getState().openTerminal(desk.id);
            notification.close();
          };
        }
      }
      initialized = true;
    });
  }, [t]);
}
