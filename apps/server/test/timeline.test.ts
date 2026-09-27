import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.ts';
import { buildTimeline } from '../src/office/timeline.ts';
import { OfficeStore, type DeskRecord } from '../src/store/officeStore.ts';

function desk(id: string, createdAt: number): DeskRecord {
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
    state: 'idle',
    stateSince: createdAt,
    currentTask: null,
    sessionTitle: null,
    currentTool: null,
    lastPrompt: null,
    lastAssistantMessage: null,
    attention: null,
    createdAt,
    token: 't',
    desiredRunning: true,
    initialPrompt: null,
    transcriptPath: null,
    inTurn: false,
    blockers: [],
  };
}

describe('buildTimeline', () => {
  it('turns state events into contiguous segments and lists prompts', () => {
    const store = new OfficeStore(openDatabase(':memory:'));
    store.insertRoom({
      id: 'r',
      name: 'R',
      projectPath: '/p',
      isGitRepo: false,
      accentColor: '#000000',
      position: 0,
      createdAt: 0,
      autoWake: true,
      worktreeFiles: [],
    });
    store.insertDesk(desk('d', 0));
    store.addDeskEvent('d', 'state', 'idle', {}, 50);
    store.addDeskEvent('d', 'state', 'working', {}, 150);
    store.addDeskEvent('d', 'hook', null, { event: 'UserPromptSubmit' }, 150);
    store.addDeskEvent('d', 'state', 'question', {}, 200);
    store.addDeskEvent('d', 'state', 'idle', {}, 260);

    const timeline = buildTimeline(store, 100, 300);
    expect(timeline.desks[0]!.segments).toEqual([
      { state: 'idle', from: 100, to: 150 },
      { state: 'working', from: 150, to: 200 },
      { state: 'question', from: 200, to: 260 },
      { state: 'idle', from: 260, to: 300 },
    ]);
    expect(timeline.desks[0]!.prompts).toEqual([150]);
  });
});
