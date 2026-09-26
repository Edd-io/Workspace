import { z } from 'zod';

/** What can be sent to the phone. */
export const NOTIFICATION_EVENTS = ['attention', 'usage', 'finished'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Phone notification settings as the client sees them (the webhook URL itself never leaves the server). */
export interface NotificationSettings {
  webhookSet: boolean;
  /** End of the webhook URL, to recognize it. */
  webhookHint: string | null;
  events: Record<NotificationEvent, boolean>;
  /** Only say which desk needs you, not what it asks. */
  hideContent: boolean;
  /** Address of Workspace from the phone (e.g. through Tailscale), for links in notifications. */
  publicUrl: string | null;
  language: 'fr' | 'en';
  lastSentAt: number | null;
  lastError: string | null;
}

export const DISCORD_WEBHOOK_PATTERN =
  /^https:\/\/(?:ptb\.|canary\.)?(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;

export const updateNotificationSettingsSchema = z.object({
  /** A new webhook URL, null to remove it, absent to keep it. */
  webhook: z.string().trim().regex(DISCORD_WEBHOOK_PATTERN).nullable().optional(),
  events: z
    .object(Object.fromEntries(NOTIFICATION_EVENTS.map((event) => [event, z.boolean()])))
    .partial()
    .optional(),
  hideContent: z.boolean().optional(),
  publicUrl: z
    .url({ protocol: /^https?$/ })
    .nullable()
    .optional(),
  language: z.enum(['fr', 'en']).optional(),
});
export type UpdateNotificationSettings = z.infer<typeof updateNotificationSettingsSchema>;
