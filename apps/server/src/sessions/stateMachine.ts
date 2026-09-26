import type { DeskState } from '@workspace/shared';

/** Subset of the Claude Code hook input we rely on. Unknown fields are ignored. */
export interface HookPayload {
  hook_event_name: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  agent_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_use_id?: string;
  session_title?: string;
  notification_type?: string;
  message?: string;
  prompt?: string;
  last_assistant_message?: string;
  error_type?: string;
  error_message?: string;
  source?: string;
  reason?: string;
  trigger?: string;
}

/**
 * A tool use waiting for the human. `PreToolUse` carries a `tool_use_id`; `PermissionRequest` does
 * not, so permission prompts are matched by tool name and input.
 */
export interface Blocker {
  toolUseId: string | null;
  tool: string;
  inputKey: string;
}

export interface DeskContext {
  state: DeskState;
  /** True between a user prompt and the end of the turn (`Stop` / `StopFailure`). */
  inTurn: boolean;
  blockers: Blocker[];
}

export interface HookEffect {
  state?: DeskState;
  inTurn?: boolean;
  /** `null` clears the current tool. */
  currentTool?: string | null;
  lastPrompt?: string;
  lastAssistantMessage?: string;
  transcriptPath?: string;
  sessionTitle?: string;
  blockers?: Blocker[];
}

/** Tools that block on the human even without a permission prompt. */
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

const QUESTION_NOTIFICATIONS = new Set([
  'permission_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'agent_needs_input',
]);

/** A turn that ends with a question addressed to the user is treated as waiting for them. */
export function endsWithQuestion(message: string | undefined): boolean {
  if (!message) return false;
  const text = message.trim().replace(/[\s*_`)\]]+$/u, '');
  return text.endsWith('?') || text.endsWith('？');
}

function inputKey(input: unknown): string {
  return JSON.stringify(input ?? null);
}

function matchesBlocker(blocker: Blocker, payload: HookPayload): boolean {
  if (payload.tool_use_id && blocker.toolUseId === payload.tool_use_id) return true;
  if (blocker.tool !== payload.tool_name || blocker.toolUseId !== null) return false;
  // Question tools get the user's answers merged into their input: match them by name only.
  return QUESTION_TOOLS.has(blocker.tool) || blocker.inputKey === inputKey(payload.tool_input);
}

/** Events that end or reset the conversation turn: nothing can still be waiting on the human. */
const TURN_BOUNDARIES = new Set(['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionStart', 'SessionEnd']);

/**
 * Pure reducer: given the current desk context and one hook payload, returns what changes.
 * Events fired from inside a subagent (`agent_id` set) never end the turn. While a question or a
 * permission prompt is pending, parallel tool activity keeps the desk in `question`.
 */
export function reduceHook(context: DeskContext, payload: HookPayload): HookEffect {
  const effect = reduceState(context, payload);
  if (payload.transcript_path && !payload.agent_id) effect.transcriptPath = payload.transcript_path;
  if (payload.session_title) effect.sessionTitle = payload.session_title;

  let blockers = context.blockers;
  const event = payload.hook_event_name;
  if (TURN_BOUNDARIES.has(event) && !payload.agent_id) {
    blockers = [];
  } else if (
    event === 'PreToolUse' &&
    payload.tool_name &&
    QUESTION_TOOLS.has(payload.tool_name) &&
    !payload.agent_id
  ) {
    blockers = [
      ...blockers,
      {
        toolUseId: payload.tool_use_id ?? null,
        tool: payload.tool_name,
        inputKey: inputKey(payload.tool_input),
      },
    ];
  } else if (event === 'PermissionRequest' && payload.tool_name) {
    const key = inputKey(payload.tool_input);
    // Question tools also raise a permission request for the same call: don't count it twice.
    if (!blockers.some((blocker) => blocker.tool === payload.tool_name && blocker.inputKey === key)) {
      blockers = [...blockers, { toolUseId: null, tool: payload.tool_name, inputKey: key }];
    }
  } else if (event === 'PostToolUse' || event === 'PostToolUseFailure' || event === 'PermissionDenied') {
    blockers = blockers.filter((blocker) => !matchesBlocker(blocker, payload));
  } else if (event === 'Notification' && payload.notification_type === 'idle_prompt') {
    blockers = [];
  }
  if (blockers !== context.blockers) effect.blockers = blockers;
  if (blockers.length > 0 && effect.state === 'working') effect.state = 'question';
  return effect;
}

function reduceState(context: DeskContext, payload: HookPayload): HookEffect {
  const effect: HookEffect = {};
  const afterPause: DeskState = context.inTurn ? 'working' : 'idle';

  switch (payload.hook_event_name) {
    case 'SessionStart':
      // `compact` restarts inside a running turn; every other source is a fresh prompt.
      effect.state = payload.source === 'compact' ? afterPause : 'idle';
      if (payload.source !== 'compact') effect.inTurn = false;
      effect.currentTool = null;
      break;

    case 'UserPromptSubmit':
      effect.state = 'working';
      effect.inTurn = true;
      effect.currentTool = null;
      if (payload.prompt !== undefined) effect.lastPrompt = payload.prompt;
      break;

    case 'PreToolUse':
      if (payload.tool_name && QUESTION_TOOLS.has(payload.tool_name) && !payload.agent_id) {
        effect.state = 'question';
      } else {
        effect.state = 'working';
      }
      effect.currentTool = payload.tool_name ?? null;
      break;

    case 'PermissionRequest':
      effect.state = 'question';
      if (payload.tool_name) effect.currentTool = payload.tool_name;
      break;

    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionDenied':
      effect.state = 'working';
      effect.currentTool = null;
      break;

    case 'SubagentStart':
      effect.state = 'working';
      break;

    case 'Notification': {
      const type = payload.notification_type;
      if (type && QUESTION_NOTIFICATIONS.has(type)) {
        effect.state = 'question';
      } else if (type === 'idle_prompt') {
        // Nobody typed for a while after the turn: covers turns interrupted with Esc (no `Stop`).
        if (context.state === 'working') {
          effect.state = 'idle';
          effect.inTurn = false;
          effect.currentTool = null;
        }
      } else if (type === 'quota_auto_resume_fired') {
        effect.state = 'working';
        effect.inTurn = true;
      }
      break;
    }

    case 'Stop':
      if (payload.agent_id) break;
      effect.inTurn = false;
      effect.currentTool = null;
      if (payload.last_assistant_message !== undefined) {
        effect.lastAssistantMessage = payload.last_assistant_message;
      }
      effect.state = endsWithQuestion(payload.last_assistant_message) ? 'question' : 'idle';
      break;

    case 'StopFailure':
      if (payload.agent_id) break;
      effect.inTurn = false;
      effect.currentTool = null;
      effect.state = payload.error_type === 'rate_limit' ? 'limited' : 'error';
      break;

    case 'PreCompact':
      effect.state = 'compacting';
      break;

    case 'PostCompact':
      effect.state = afterPause;
      break;

    case 'SessionEnd':
      // `/clear` ends the conversation but the process keeps running and starts a new one.
      if (payload.reason !== 'clear' && payload.reason !== 'resume') {
        effect.state = 'offline';
        effect.inTurn = false;
        effect.currentTool = null;
      }
      break;

    default:
      break;
  }

  return effect;
}
