import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ATTENTION_STATES,
  DESK_STATE_COLORS,
  type Desk,
  type DeskState,
  type NotificationEvent,
  type NotificationSettings,
  type UpdateNotificationSettings,
  type UsageAlert,
} from '@workspace/shared';
import type { OfficeStore } from '../store/officeStore.ts';

/**
 * Phone notifications through a Discord webhook: a desk that needs the human, the subscription
 * running out, optionally a long task finished. Only sent when no Workspace tab is visible (the office
 * already shows toasts then); events are grouped into one message. Texts come from the web client's
 * locale files, in the language chosen in the settings.
 */

const SETTINGS_KEY = 'notifications';
/** Events are grouped for that long before being sent. */
const GROUP_MS = 5000;
/** Nobody counts as watching once every tab has been hidden or closed for that long. */
export const AWAY_MS = 30_000;
/** A task counts as long (worth a "finished" notification) after that much work. */
const LONG_TASK_MS = 5 * 60_000;
const MAX_EMBEDS = 10;

interface StoredSettings {
  webhook: string | null;
  events: Record<NotificationEvent, boolean>;
  hideContent: boolean;
  publicUrl: string | null;
  language: 'fr' | 'en';
  lastSentAt: number | null;
  lastError: string | null;
}

const DEFAULTS: StoredSettings = {
  webhook: null,
  events: { attention: true, usage: true, finished: false },
  hideContent: false,
  publicUrl: null,
  language: 'fr',
  lastSentAt: null,
  lastError: null,
};

type Pending =
  | { kind: 'attention'; deskId: string; state: DeskState }
  | { kind: 'finished'; deskId: string; minutes: number }
  | { kind: 'usage'; alert: UsageAlert };

export interface Embed {
  title: string;
  description?: string;
  color: number;
  url?: string;
  footer?: { text: string };
}

/** Which Workspace tabs are visible. */
export class Presence {
  private readonly visible = new Set<unknown>();
  private lastVisibleAt = 0;

  set(client: unknown, visible: boolean, now = Date.now()): void {
    if (this.visible.has(client)) this.lastVisibleAt = now;
    if (visible) this.visible.add(client);
    else this.visible.delete(client);
    if (visible) this.lastVisibleAt = now;
  }

  remove(client: unknown, now = Date.now()): void {
    this.set(client, false, now);
  }

  /** A Workspace tab is visible right now. */
  visibleNow(): boolean {
    return this.visible.size > 0;
  }

  /** Someone looks at the office now, or did less than AWAY_MS ago. */
  watching(now = Date.now()): boolean {
    return this.visible.size > 0 || now - this.lastVisibleAt < AWAY_MS;
  }

  /** When nobody will have been watching for AWAY_MS (if nobody comes back). */
  awayAt(): number {
    return this.lastVisibleAt + AWAY_MS;
  }
}

type Dictionary = Record<string, unknown>;

/** Reads the web client's locale files (the only place with non-English texts). */
export function loadLocales(repoRoot: string): Record<'fr' | 'en', Dictionary> {
  const read = (language: string) =>
    JSON.parse(
      readFileSync(join(repoRoot, 'apps/web/src/locales', language, 'common.json'), 'utf8'),
    ) as Dictionary;
  return { fr: read('fr'), en: read('en') };
}

export function translate(
  dictionary: Dictionary,
  language: string,
  key: string,
  variables: Record<string, string | number> = {},
): string {
  const lookup = (path: string): unknown =>
    path.split('.').reduce<unknown>((node, part) => (node as Dictionary | undefined)?.[part], dictionary);
  let template = lookup(key);
  if (typeof variables.count === 'number') {
    const plural = new Intl.PluralRules(language).select(variables.count);
    template = lookup(`${key}_${plural}`) ?? lookup(`${key}_other`) ?? template;
  }
  if (typeof template !== 'string') return key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(variables[name] ?? ''));
}

export type Sender = (webhook: string, body: unknown) => Promise<void>;

async function postToDiscord(webhook: string, body: unknown): Promise<void> {
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Discord answered ${response.status}`);
}

export class Notifier {
  private readonly store: OfficeStore;
  private readonly presence: Presence;
  private readonly locales: Record<'fr' | 'en', Dictionary>;
  private readonly send: Sender;
  private readonly groupMs: number;
  private settings: StoredSettings;
  private queue: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly lastState = new Map<string, DeskState>();
  private readonly workingSince = new Map<string, number>();

  constructor(
    store: OfficeStore,
    presence: Presence,
    locales: Record<'fr' | 'en', Dictionary>,
    send: Sender = postToDiscord,
    groupMs = GROUP_MS,
  ) {
    this.store = store;
    this.presence = presence;
    this.locales = locales;
    this.send = send;
    this.groupMs = groupMs;
    const saved = store.getSetting(SETTINGS_KEY);
    this.settings = saved
      ? { ...DEFAULTS, ...(JSON.parse(saved) as Partial<StoredSettings>) }
      : { ...DEFAULTS };
  }

  start(): void {
    for (const desk of this.store.listDesks()) this.lastState.set(desk.id, desk.state);
    this.store.on('deskUpsert', (desk) => this.onDesk(desk));
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ---- settings ----------------------------------------------------------------------------

  publicSettings(): NotificationSettings {
    const { webhook, ...rest } = this.settings;
    return { ...rest, webhookSet: webhook !== null, webhookHint: webhook ? `…${webhook.slice(-6)}` : null };
  }

  update(input: UpdateNotificationSettings): NotificationSettings {
    const next = { ...this.settings };
    if (input.webhook !== undefined) next.webhook = input.webhook;
    if (input.events) next.events = { ...next.events, ...input.events };
    if (input.hideContent !== undefined) next.hideContent = input.hideContent;
    if (input.publicUrl !== undefined) next.publicUrl = input.publicUrl?.replace(/\/+$/, '') ?? null;
    if (input.language) next.language = input.language;
    this.settings = next;
    this.save();
    return this.publicSettings();
  }

  private save(): void {
    this.store.setSetting(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  private t(key: string, variables?: Record<string, string | number>): string {
    return translate(this.locales[this.settings.language], this.settings.language, key, variables);
  }

  /** Sends a test message right away, whoever is watching. */
  async test(): Promise<void> {
    if (!this.settings.webhook) throw new Error('No webhook configured.');
    await this.deliver({ content: this.t('notifications.discord.test') });
  }

  // ---- events ------------------------------------------------------------------------------

  onUsageAlert(alert: UsageAlert): void {
    this.enqueue({ kind: 'usage', alert });
  }

  private onDesk(desk: Desk): void {
    const previous = this.lastState.get(desk.id);
    this.lastState.set(desk.id, desk.state);
    if (previous === undefined || previous === desk.state) return;
    const now = Date.now();
    if (desk.state === 'working') this.workingSince.set(desk.id, now);
    if (ATTENTION_STATES.has(desk.state) && !ATTENTION_STATES.has(previous)) {
      this.enqueue({ kind: 'attention', deskId: desk.id, state: desk.state });
    }
    if (previous === 'working' && desk.state === 'idle') {
      const since = this.workingSince.get(desk.id);
      if (since !== undefined && now - since >= LONG_TASK_MS) {
        this.enqueue({ kind: 'finished', deskId: desk.id, minutes: Math.round((now - since) / 60_000) });
      }
    }
  }

  private enqueue(event: Pending): void {
    if (!this.settings.webhook || !this.settings.events[event.kind]) return;
    // Someone is looking at the office right now: the in-app toast is enough.
    if (this.presence.visibleNow()) return;
    this.queue.push(event);
    this.schedule(Date.now() + this.groupMs);
  }

  private schedule(at: number): void {
    if (this.timer) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.flush();
      },
      Math.max(0, at - Date.now()),
    );
  }

  /** Sends what is still relevant, grouped; waits while the human may still be at the screen. */
  async flush(now = Date.now()): Promise<void> {
    if (this.queue.length === 0) return;
    // Back at the screen meanwhile: the office shows it.
    if (this.presence.visibleNow()) {
      this.queue = [];
      return;
    }
    // Just left: give it AWAY_MS before bothering the phone.
    if (this.presence.watching(now)) {
      this.schedule(Math.max(this.presence.awayAt(), now + 1000));
      return;
    }
    const events = this.queue;
    this.queue = [];
    const embeds = this.embedsFor(events).slice(0, MAX_EMBEDS);
    if (embeds.length === 0) return;
    const waiting = events.filter((event) => event.kind === 'attention').length;
    await this.deliver({
      ...(waiting > 0 ? { content: this.t('notifications.discord.waiting', { count: waiting }) } : {}),
      embeds,
    });
  }

  embedsFor(events: Pending[]): Embed[] {
    const embeds: Embed[] = [];
    const seen = new Set<string>();
    for (const event of events) {
      if (event.kind === 'usage') {
        const { alert } = event;
        const reset = new Intl.DateTimeFormat(this.settings.language, {
          weekday: alert.window === 'sevenDay' ? 'short' : undefined,
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(alert.resetsAt));
        embeds.push({
          title: this.t('usage.alert.title', { percent: Math.round(alert.usedPercentage) }),
          description: this.t('usage.alert.body', {
            window: this.t(alert.window === 'fiveHour' ? 'usage.fiveHour' : 'usage.sevenDay'),
            reset,
          }),
          color: 0xff9f1a,
        });
        continue;
      }
      const key = `${event.kind}:${event.deskId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const desk = this.store.getDesk(event.deskId);
      if (!desk) continue;
      // Answered in the meantime: nothing to say any more.
      if (event.kind === 'attention' && desk.state !== event.state) continue;
      const room = this.store.getRoom(desk.roomId)?.name ?? '';
      const url = this.settings.publicUrl ? `${this.settings.publicUrl}/?desk=${desk.id}` : undefined;
      if (event.kind === 'attention') {
        const detail = desk.attention?.text?.trim();
        embeds.push({
          title: this.t('notifications.discord.attentionTitle', { desk: desk.name, room }),
          description:
            this.settings.hideContent || !detail ? this.t(`states.${desk.state}`) : truncate(detail, 500),
          color: colorOf(desk.state),
          ...(url ? { url } : {}),
          footer: { text: this.t(`states.${desk.state}`) },
        });
      } else {
        const topic = desk.sessionTitle ?? desk.currentTask;
        embeds.push({
          title: this.t('notifications.discord.finishedTitle', { desk: desk.name, room }),
          description: [
            this.t('notifications.discord.finishedBody', { minutes: event.minutes }),
            !this.settings.hideContent && topic ? truncate(topic, 200) : '',
          ]
            .filter(Boolean)
            .join('\n'),
          color: colorOf('idle'),
          ...(url ? { url } : {}),
        });
      }
    }
    return embeds;
  }

  private async deliver(body: Record<string, unknown>): Promise<void> {
    const webhook = this.settings.webhook;
    if (!webhook) return;
    try {
      await this.send(webhook, { username: 'Workspace', ...body });
      this.settings.lastSentAt = Date.now();
      this.settings.lastError = null;
    } catch (error) {
      this.settings.lastError = (error as Error).message;
      console.warn('[notifications] cannot send to Discord:', (error as Error).message);
    }
    this.save();
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function colorOf(state: DeskState): number {
  return Number.parseInt(DESK_STATE_COLORS[state].slice(1), 16);
}
