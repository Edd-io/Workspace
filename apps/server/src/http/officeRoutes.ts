import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { postRoomMessageSchema, postRoomNoteSchema } from '@workspace/shared';
import type { BoardStore } from '../office/boardStore.ts';
import { deskTopic, type RoomAwareness } from '../office/roomAwareness.ts';
import { statusLineSchema, statusLineText, type UsageTracker } from '../office/usageTracker.ts';
import type { DeskRecord, OfficeStore } from '../store/officeStore.ts';

interface Deps {
  store: OfficeStore;
  boards: BoardStore;
  awareness: RoomAwareness;
  usage: UsageTracker;
}

function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Resolves the desk calling an internal endpoint from its bearer token; replies 403 otherwise. */
export function authenticateDesk(
  store: OfficeStore,
  request: FastifyRequest<{ Params: { deskId: string } }>,
  reply: FastifyReply,
): DeskRecord | null {
  const desk = store.getDesk(request.params.deskId);
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!desk || !tokensEqual(token, desk.token)) {
    void reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  return desk;
}

const setTaskSchema = z.object({ task: z.string().trim().max(200) });
const delegateSchema = z.object({
  to: z.string().trim().min(1),
  task: z.string().trim().min(1).max(4000),
});

/** The first line of a delegated task, short enough for the desk's topic. */
function oneLineTask(task: string): string {
  const line = task.split('\n')[0]!.trim();
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}
const deskMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  /** Recipient desk name or id; omitted to address the whole room. */
  to: z.string().trim().min(1).optional(),
});

export function registerOfficeRoutes(app: FastifyInstance, { store, boards, awareness, usage }: Deps): void {
  // ---- internal: status line of each desk (relayed by curl, see launchConfig.ts) ---------------

  app.post<{ Params: { deskId: string } }>('/internal/office/:deskId/status', async (request, reply) => {
    const desk = authenticateDesk(store, request, reply);
    if (!desk) return reply;
    const parsed = statusLineSchema.safeParse(request.body ?? {});
    if (parsed.success) usage.report(desk.id, parsed.data);
    const room = store.getRoom(desk.roomId);
    const stats = usage.deskStats()[desk.id];
    const text = stats
      ? statusLineText(room?.name ?? '', desk.name, stats, usage.usage())
      : `Workspace · ${desk.name}`;
    // Claude Code prints what the status line command writes: plain text.
    return reply.type('text/plain; charset=utf-8').send(text);
  });

  // ---- internal: called by the office MCP server of each desk -----------------------------------

  app.get<{ Params: { deskId: string } }>('/internal/office/:deskId/colleagues', async (request, reply) => {
    const desk = authenticateDesk(store, request, reply);
    if (!desk) return reply;
    return {
      you: desk.name,
      colleagues: awareness.colleagues(desk).map((other) => ({
        name: other.name,
        role: other.role,
        state: other.state,
        topic: deskTopic(other),
        branch: other.branch,
        mode: other.mode,
      })),
    };
  });

  app.post<{ Params: { deskId: string } }>('/internal/office/:deskId/task', async (request, reply) => {
    const desk = authenticateDesk(store, request, reply);
    if (!desk) return reply;
    const { task } = setTaskSchema.parse(request.body);
    store.updateDesk(desk.id, { currentTask: task === '' ? null : task });
    return { ok: true };
  });

  app.post<{ Params: { deskId: string } }>('/internal/office/:deskId/messages', async (request, reply) => {
    const desk = authenticateDesk(store, request, reply);
    if (!desk) return reply;
    const { body, to } = deskMessageSchema.parse(request.body);
    let toDeskId: string | null = null;
    if (to) {
      const target = awareness
        .colleagues(desk)
        .find((other) => other.id === to || other.name.toLowerCase() === to.toLowerCase());
      if (!target) {
        return reply.code(404).send({
          error: 'unknown_colleague',
          colleagues: awareness.colleagues(desk).map((other) => other.name),
        });
      }
      toDeskId = target.id;
    }
    const message = boards.postMessage(desk.roomId, desk.id, toDeskId, body);
    return { ok: true, id: message.id };
  });

  // A task handed to a colleague: a message to it, its declared task, and (WakeService) its session
  // gets it right away when idle.
  app.post<{ Params: { deskId: string } }>('/internal/office/:deskId/delegate', async (request, reply) => {
    const desk = authenticateDesk(store, request, reply);
    if (!desk) return reply;
    const { to, task } = delegateSchema.parse(request.body);
    const target = awareness
      .colleagues(desk)
      .find((other) => other.id === to || other.name.toLowerCase() === to.toLowerCase());
    if (!target) {
      return reply.code(404).send({
        error: 'unknown_colleague',
        colleagues: awareness.colleagues(desk).map((other) => other.name),
      });
    }
    const message = boards.postMessage(desk.roomId, desk.id, target.id, `Task for you: ${task}`);
    store.updateDesk(target.id, { currentTask: oneLineTask(task) });
    store.addDeskEvent(target.id, 'delegated', null, { from: desk.id });
    return { ok: true, id: message.id, to: target.name, state: target.state };
  });

  app.get<{ Params: { deskId: string } }>('/internal/office/:deskId/messages', async (request, reply) => {
    const desk = authenticateDesk(store, request, reply);
    if (!desk) return reply;
    const unread = awareness.takeUnread(desk);
    return {
      messages: unread.map((message) => ({
        from: awareness.deskName(message.fromDeskId),
        toYouOnly: message.toDeskId !== null,
        body: message.body,
        at: new Date(message.createdAt).toISOString(),
      })),
    };
  });

  app.get<{ Params: { deskId: string } }>('/internal/office/:deskId/board', async (request, reply) => {
    const desk = authenticateDesk(store, request, reply);
    if (!desk) return reply;
    const board = boards.board(desk.roomId);
    return {
      notes: board.notes.map((note) => ({
        id: note.id,
        author: awareness.deskName(note.deskId),
        body: note.body,
      })),
      recentMessages: board.messages.map((message) => ({
        from: awareness.deskName(message.fromDeskId),
        to: message.toDeskId ? awareness.deskName(message.toDeskId) : 'room',
        body: message.body,
      })),
    };
  });

  app.post<{ Params: { deskId: string } }>('/internal/office/:deskId/notes', async (request, reply) => {
    const desk = authenticateDesk(store, request, reply);
    if (!desk) return reply;
    const { body } = postRoomNoteSchema.parse(request.body);
    const note = boards.postNote(desk.roomId, desk.id, body);
    return { ok: true, id: note.id };
  });

  app.delete<{ Params: { deskId: string; noteId: string } }>(
    '/internal/office/:deskId/notes/:noteId',
    async (request, reply) => {
      const desk = authenticateDesk(store, request, reply);
      if (!desk) return reply;
      const removed = boards.removeNote(desk.roomId, Number(request.params.noteId));
      return removed ? { ok: true } : reply.code(404).send({ error: 'note_not_found' });
    },
  );

  // ---- public: the human reads and writes on room boards --------------------------------------

  app.get<{ Params: { roomId: string } }>('/api/rooms/:roomId/board', async (request, reply) => {
    if (!store.getRoom(request.params.roomId)) return reply.code(404).send({ error: 'room_not_found' });
    return boards.board(request.params.roomId);
  });

  app.post<{ Params: { roomId: string } }>('/api/rooms/:roomId/messages', async (request, reply) => {
    if (!store.getRoom(request.params.roomId)) return reply.code(404).send({ error: 'room_not_found' });
    const parsed = postRoomMessageSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const toDeskId = parsed.data.toDeskId ?? null;
    if (toDeskId && store.getDesk(toDeskId)?.roomId !== request.params.roomId) {
      return reply.code(400).send({ error: 'desk_not_found' });
    }
    return boards.postMessage(request.params.roomId, null, toDeskId, parsed.data.body);
  });

  app.post<{ Params: { roomId: string } }>('/api/rooms/:roomId/notes', async (request, reply) => {
    if (!store.getRoom(request.params.roomId)) return reply.code(404).send({ error: 'room_not_found' });
    const parsed = postRoomNoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    return boards.postNote(request.params.roomId, null, parsed.data.body);
  });

  app.delete<{ Params: { roomId: string; noteId: string } }>(
    '/api/rooms/:roomId/notes/:noteId',
    async (request, reply) => {
      const removed = boards.removeNote(request.params.roomId, Number(request.params.noteId));
      return removed ? { ok: true } : reply.code(404).send({ error: 'note_not_found' });
    },
  );
}
