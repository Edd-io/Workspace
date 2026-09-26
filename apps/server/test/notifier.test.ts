import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeskState } from '@workspace/shared';
import { openDatabase } from '../src/db/database.ts';
import { AWAY_MS, loadLocales, Notifier, Presence, translate } from '../src/office/notifier.ts';
import { OfficeStore, type DeskRecord } from '../src/store/officeStore.ts';

const WEBHOOK = 'https://discord.com/api/webhooks/123/abc-DEF';
const locales = loadLocales(resolve(join(import.meta.dirname, '../../..')));

function desk(id: string, state: DeskState): DeskRecord {
  return {
    id,
    roomId: 'r',
    name: id,
    slug: id,
    mode: 'shared',
    workdir: '/w',
    branch: null,
    baseBranch: null,
    role: null,
    sessionId: id,
    model: null,
    permissionMode: null,
    appearanceSeed: 1,
    position: 0,
    state,
    stateSince: 0,
    currentTask: null,
    sessionTitle: null,
    currentTool: null,
    lastPrompt: null,
    lastAssistantMessage: null,
    attention: null,
    createdAt: 0,
    token: 't',
    desiredRunning: true,
    initialPrompt: null,
    transcriptPath: null,
    inTurn: false,
    blockers: [],
  };
}

function setup() {
  const store = new OfficeStore(openDatabase(':memory:'));
  store.insertRoom({
    id: 'r',
    name: 'Demo',
    projectPath: '/p',
    isGitRepo: false,
    accentColor: '#000000',
    position: 0,
    createdAt: 0,
    autoWake: true,
  });
  store.insertDesk(desk('Ken', 'working'));
  store.insertDesk(desk('Ada', 'working'));
  const presence = new Presence();
  const sent: { content?: string; embeds?: { title: string; description?: string; url?: string }[] }[] = [];
  const notifier = new Notifier(
    store,
    presence,
    locales,
    async (_webhook, body) => void sent.push(body as never),
    0,
  );
  notifier.update({ webhook: WEBHOOK, language: 'fr', publicUrl: 'https://office.example/' });
  notifier.start();
  return { store, presence, notifier, sent };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('translate', () => {
  it('interpolates and picks plural forms', () => {
    expect(translate(locales.fr, 'fr', 'notifications.discord.waiting', { count: 1 })).toBe(
      "1 poste t'attend",
    );
    expect(translate(locales.en, 'en', 'notifications.discord.waiting', { count: 3 })).toBe(
      '3 desks are waiting for you',
    );
  });
});

describe('Notifier', () => {
  it('never sends the webhook URL to clients', () => {
    const { notifier } = setup();
    const settings = notifier.publicSettings();
    expect(JSON.stringify(settings)).not.toContain(WEBHOOK);
    expect(settings.webhookSet).toBe(true);
    expect(settings.webhookHint).toBe('…bc-DEF');
    expect(settings.publicUrl).toBe('https://office.example');
  });

  it('groups desks that need the human into one message, with links, when nobody watches', async () => {
    const { store, notifier, sent } = setup();
    store.updateDesk('Ken', { state: 'question', attention: { kind: 'question', text: 'Which database?' } });
    store.updateDesk('Ada', { state: 'error', attention: { kind: 'error', text: 'Tests fail' } });
    await tick();
    await notifier.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.content).toBe("2 postes t'attendent");
    expect(sent[0]!.embeds!.map((embed) => embed.title)).toEqual([
      "Ken (Demo) t'attend",
      "Ada (Demo) t'attend",
    ]);
    expect(sent[0]!.embeds![0]!.description).toBe('Which database?');
    expect(sent[0]!.embeds![0]!.url).toBe('https://office.example/?desk=Ken');
  });

  it('stays quiet while a tab is visible, waits after leaving, drops what was answered', async () => {
    const { store, presence, notifier, sent } = setup();
    const tab = {};
    presence.set(tab, true);
    store.updateDesk('Ken', { state: 'question' });
    await tick();
    expect(sent).toHaveLength(0);

    presence.set(tab, false);
    store.updateDesk('Ada', { state: 'question' });
    await notifier.flush(Date.now());
    expect(sent).toHaveLength(0);
    // Ada got an answer before the phone was bothered.
    store.updateDesk('Ada', { state: 'working' });
    await notifier.flush(Date.now() + AWAY_MS + 1);
    expect(sent).toHaveLength(0);
    notifier.stop();
  });

  it('can hide what desks ask', async () => {
    const { store, notifier, sent } = setup();
    notifier.update({ hideContent: true });
    store.updateDesk('Ken', { state: 'question', attention: { kind: 'question', text: 'Secret plan?' } });
    await notifier.flush();
    expect(JSON.stringify(sent)).not.toContain('Secret plan');
  });
});
