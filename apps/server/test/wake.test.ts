import { describe, expect, it } from 'vitest';
import type { DeskState } from '@workspace/shared';
import { openDatabase } from '../src/db/database.ts';
import { BoardStore } from '../src/office/boardStore.ts';
import { MAX_WAKES, WakeService, WINDOW_MS } from '../src/office/wakeService.ts';
import { OfficeStore, type DeskRecord } from '../src/store/officeStore.ts';

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
  const db = openDatabase(':memory:');
  const store = new OfficeStore(db);
  const boards = new BoardStore(db);
  store.insertRoom({
    id: 'r',
    name: 'R',
    projectPath: '/p',
    isGitRepo: false,
    accentColor: '#000000',
    position: 0,
    createdAt: 0,
    autoWake: true,
  });
  store.insertDesk(desk('ada', 'idle'));
  store.insertDesk(desk('ken', 'working'));
  const prompts: string[] = [];
  const wake = new WakeService(store, boards, { sendPrompt: (deskId) => prompts.push(deskId) }, 0);
  return { store, boards, wake, prompts };
}

describe('WakeService', () => {
  it('wakes an idle desk that has unread messages, not a busy one', () => {
    const { boards, wake, prompts } = setup();
    boards.postMessage('r', 'ken', 'ada', 'Can you review my branch?');
    boards.postMessage('r', 'ada', 'ken', 'Sure');
    expect(wake.wake('ada')).toBe(true);
    expect(wake.wake('ken')).toBe(false);
    expect(prompts).toEqual(['ada']);
  });

  it('does nothing without unread messages or when the room turned it off', () => {
    const { store, boards, wake } = setup();
    expect(wake.wake('ada')).toBe(false);
    boards.postMessage('r', null, null, 'Standup in 5 minutes');
    store.updateRoom('r', { autoWake: false });
    expect(wake.wake('ada')).toBe(false);
  });

  it('limits how often a desk is woken up', () => {
    const { boards, wake, prompts } = setup();
    boards.postMessage('r', 'ken', 'ada', 'ping');
    for (let i = 0; i < MAX_WAKES + 2; i++) wake.wake('ada', 1000 + i);
    expect(prompts).toHaveLength(MAX_WAKES);
    expect(wake.wake('ada', 1000 + WINDOW_MS + 10)).toBe(true);
  });

  it('wakes the recipients of a message and a desk going idle with unread messages', async () => {
    const { store, boards, wake, prompts } = setup();
    wake.start();
    boards.postMessage('r', null, null, 'Hello everyone');
    await new Promise((resolve) => setTimeout(resolve, 20));
    // ada was idle; ken was working and gets it once idle.
    expect(prompts).toEqual(['ada']);
    store.updateDesk('ken', { state: 'idle' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(prompts).toEqual(['ada', 'ken']);
    wake.stop();
  });
});
