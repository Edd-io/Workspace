#!/usr/bin/env node
/**
 * Office MCP server: started by every desk's Claude Code session (stdio). Lets the session see its
 * colleagues in the same room, declare its current task, exchange messages and use the room board.
 * It only talks to the Workspace server, authenticated with the desk token.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const baseUrl = process.env.WORKSPACE_URL;
const deskId = process.env.WORKSPACE_DESK_ID;
const token = process.env.WORKSPACE_DESK_TOKEN;
if (!baseUrl || !deskId || !token) {
  console.error('WORKSPACE_URL, WORKSPACE_DESK_ID and WORKSPACE_DESK_TOKEN must be set.');
  process.exit(1);
}

async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${baseUrl}/internal/office/${deskId}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Workspace server error ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function text(value: unknown) {
  return {
    content: [
      { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

async function run<T>(action: () => Promise<T>) {
  try {
    return text(await action());
  } catch (error) {
    return { ...text((error as Error).message), isError: true };
  }
}

const server = new McpServer({ name: 'workspace-office', version: '1.0.0' });

server.registerTool(
  'colleagues',
  {
    title: 'List colleagues',
    description:
      'List the other Claude Code sessions (desks) working in your room: their name, state, what they are working on and their git branch.',
    annotations: { readOnlyHint: true },
  },
  () => run(() => call('GET', '/colleagues')),
);

server.registerTool(
  'set_task',
  {
    title: 'Declare current task',
    description:
      'Declare in a few words what you are working on, so your colleagues and the human supervisor know it. Call it when you start a new task; pass an empty string when you are done.',
    inputSchema: { task: z.string().max(200).describe('Short description, e.g. "Refactor the login form"') },
  },
  ({ task }) => run(() => call('POST', '/task', { task })),
);

server.registerTool(
  'send_message',
  {
    title: 'Message a colleague',
    description:
      'Send a short, actionable message to one colleague (by desk name) or to the whole room (omit "to"). Use it to coordinate: avoid working on the same files, hand over work, ask a question.',
    inputSchema: {
      message: z.string().min(1).max(4000),
      to: z.string().optional().describe('Desk name of the recipient; omit to address the whole room'),
    },
  },
  ({ message, to }) => run(() => call('POST', '/messages', { body: message, ...(to ? { to } : {}) })),
);

server.registerTool(
  'read_messages',
  {
    title: 'Read new messages',
    description:
      'Read the messages your colleagues or the human sent you (or the whole room) since you last read them. New messages are also shown to you automatically in your context.',
  },
  () => run(() => call('GET', '/messages')),
);

server.registerTool(
  'board',
  {
    title: 'Read the room board',
    description:
      'Read the shared room board: pinned notes (decisions, conventions) and the recent room messages.',
    annotations: { readOnlyHint: true },
  },
  () => run(() => call('GET', '/board')),
);

server.registerTool(
  'post_note',
  {
    title: 'Pin a note on the room board',
    description:
      'Pin a short note on the room board for every desk: a decision, a convention, a warning. Keep notes few and durable.',
    inputSchema: { note: z.string().min(1).max(1000) },
  },
  ({ note }) => run(() => call('POST', '/notes', { body: note })),
);

server.registerTool(
  'remove_note',
  {
    title: 'Remove a note from the room board',
    description: 'Remove a pinned note that is no longer true, by its id (see the board tool).',
    inputSchema: { id: z.number().int().positive() },
  },
  ({ id }) => run(() => call('DELETE', `/notes/${id}`)),
);

await server.connect(new StdioServerTransport());
