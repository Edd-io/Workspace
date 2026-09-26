import { describe, expect, it } from 'vitest';
import {
  endsWithQuestion,
  reduceHook,
  type DeskContext,
  type HookPayload,
} from '../src/sessions/stateMachine.ts';

function ctx(state: DeskContext['state'], inTurn: boolean): DeskContext {
  return { state, inTurn, blockers: [] };
}

function run(events: HookPayload[], start: DeskContext = ctx('starting', false)): DeskContext {
  return events.reduce<DeskContext>((context, payload) => {
    const effect = reduceHook(context, payload);
    return {
      state: effect.state ?? context.state,
      inTurn: effect.inTurn ?? context.inTurn,
      blockers: effect.blockers ?? context.blockers,
    };
  }, start);
}

describe('reduceHook', () => {
  it('goes idle on session start and working on prompt', () => {
    expect(run([{ hook_event_name: 'SessionStart', source: 'startup' }]).state).toBe('idle');
    const context = run([
      { hook_event_name: 'SessionStart', source: 'startup' },
      { hook_event_name: 'UserPromptSubmit', prompt: 'fix the bug' },
    ]);
    expect(context).toEqual(ctx('working', true));
  });

  it('records the prompt and the current tool', () => {
    const context: DeskContext = ctx('idle', false);
    expect(reduceHook(context, { hook_event_name: 'UserPromptSubmit', prompt: 'hello' }).lastPrompt).toBe(
      'hello',
    );
    expect(reduceHook(context, { hook_event_name: 'PreToolUse', tool_name: 'Edit' }).currentTool).toBe(
      'Edit',
    );
  });

  it('asks the user on permission requests and question tools', () => {
    const working: DeskContext = ctx('working', true);
    expect(reduceHook(working, { hook_event_name: 'PermissionRequest', tool_name: 'Bash' }).state).toBe(
      'question',
    );
    expect(reduceHook(working, { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }).state).toBe(
      'question',
    );
    expect(
      reduceHook(working, { hook_event_name: 'Notification', notification_type: 'permission_prompt' }).state,
    ).toBe('question');
  });

  it('resumes working after the tool runs', () => {
    const context = run(
      [
        { hook_event_name: 'PermissionRequest', tool_name: 'Bash' },
        { hook_event_name: 'PostToolUse', tool_name: 'Bash' },
      ],
      ctx('working', true),
    );
    expect(context.state).toBe('working');
  });

  it('ends the turn on stop, as a question when the last message asks one', () => {
    const working: DeskContext = ctx('working', true);
    expect(reduceHook(working, { hook_event_name: 'Stop', last_assistant_message: 'Done.' })).toMatchObject({
      state: 'idle',
      inTurn: false,
      lastAssistantMessage: 'Done.',
    });
    expect(
      reduceHook(working, {
        hook_event_name: 'Stop',
        last_assistant_message: 'Should I also update the docs?',
      }).state,
    ).toBe('question');
  });

  it('ignores subagent stops', () => {
    const working: DeskContext = ctx('working', true);
    expect(reduceHook(working, { hook_event_name: 'Stop', agent_id: 'a1' }).state).toBeUndefined();
  });

  it('maps stop failures to limited or error', () => {
    const working: DeskContext = ctx('working', true);
    expect(reduceHook(working, { hook_event_name: 'StopFailure', error_type: 'rate_limit' }).state).toBe(
      'limited',
    );
    expect(reduceHook(working, { hook_event_name: 'StopFailure', error_type: 'server_error' }).state).toBe(
      'error',
    );
  });

  it('returns to the right state after compaction', () => {
    expect(
      run([{ hook_event_name: 'PreCompact' }, { hook_event_name: 'PostCompact' }], ctx('working', true))
        .state,
    ).toBe('working');
    expect(
      run([{ hook_event_name: 'PreCompact' }, { hook_event_name: 'PostCompact' }], ctx('idle', false)).state,
    ).toBe('idle');
  });

  it('falls back to idle when a turn was interrupted', () => {
    const context = run(
      [{ hook_event_name: 'Notification', notification_type: 'idle_prompt' }],
      ctx('working', true),
    );
    expect(context).toEqual(ctx('idle', false));
  });

  it('keeps running across /clear but goes offline on exit', () => {
    const idle: DeskContext = ctx('idle', false);
    expect(reduceHook(idle, { hook_event_name: 'SessionEnd', reason: 'clear' }).state).toBeUndefined();
    expect(reduceHook(idle, { hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }).state).toBe(
      'offline',
    );
  });
});

describe('blockers', () => {
  it('stays in question while a question is pending, even with parallel tools', () => {
    const context = run(
      [
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'AskUserQuestion',
          tool_use_id: 'q1',
          tool_input: { q: 1 },
        },
        { hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { q: 1 } },
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_use_id: 'b1',
          tool_input: { command: 'ls' },
        },
        {
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_use_id: 'b1',
          tool_input: { command: 'ls' },
        },
      ],
      ctx('working', true),
    );
    expect(context.state).toBe('question');
    const answered = run(
      [
        {
          hook_event_name: 'PostToolUse',
          tool_name: 'AskUserQuestion',
          tool_use_id: 'q1',
          tool_input: { q: 1, answers: { q: 'multiply' } },
        },
      ],
      context,
    );
    expect(answered.state).toBe('working');
    expect(answered.blockers).toEqual([]);
  });

  it('clears permission prompts by tool name and input', () => {
    const context = run(
      [
        { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm x' } },
        {
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_use_id: 't9',
          tool_input: { command: 'rm x' },
        },
      ],
      ctx('working', true),
    );
    expect(context).toEqual(ctx('working', true));
  });

  it('captures the session title', () => {
    expect(
      reduceHook(ctx('idle', false), {
        hook_event_name: 'UserPromptSubmit',
        prompt: 'x',
        session_title: 'Fix login',
      }).sessionTitle,
    ).toBe('Fix login');
  });
});

describe('endsWithQuestion', () => {
  it('detects trailing question marks, ignoring markdown noise', () => {
    expect(endsWithQuestion('Which one do you prefer?')).toBe(true);
    expect(endsWithQuestion('Which one do you prefer?**  ')).toBe(true);
    expect(endsWithQuestion('Is it ok? I went ahead anyway.')).toBe(false);
    expect(endsWithQuestion(undefined)).toBe(false);
  });
});
