import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { clientMessageSchema, type ServerMessage } from '@workspace/shared';
import type { BoardStore } from '../office/boardStore.ts';
import type { Summarizer } from '../office/summarizer.ts';
import type { Presence } from '../office/notifier.ts';
import type { UsageTracker } from '../office/usageTracker.ts';
import type { TerminalSubscriber } from '../sessions/deskRuntime.ts';
import type { SessionManager } from '../sessions/sessionManager.ts';
import { toPublicDesk, type OfficeStore } from '../store/officeStore.ts';

/** Above this amount of buffered bytes, preview frames are dropped for the congested client. */
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

interface Deps {
  store: OfficeStore;
  sessions: SessionManager;
  boards: BoardStore;
  summarizer: Summarizer;
  usage: UsageTracker;
  presence: Presence;
}

class ClientConnection implements TerminalSubscriber {
  readonly socket: WebSocket;
  /** Desks this client may type into (opened in interactive mode). */
  readonly interactiveDesks = new Set<string>();

  constructor(socket: WebSocket) {
    this.socket = socket;
  }

  send(message: ServerMessage): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(message));
  }

  canReceive(): boolean {
    return this.socket.bufferedAmount < MAX_BUFFERED_BYTES;
  }
}

export function registerWebSocket(
  app: FastifyInstance,
  { store, sessions, boards, summarizer, usage, presence }: Deps,
): void {
  const clients = new Set<ClientConnection>();

  const broadcast = (message: ServerMessage): void => {
    for (const client of clients) client.send(message);
  };
  store.on('roomUpsert', (room) => broadcast({ t: 'room.upsert', room }));
  store.on('roomRemoved', (roomId) => broadcast({ t: 'room.removed', roomId }));
  store.on('deskUpsert', (desk) => broadcast({ t: 'desk.upsert', desk }));
  store.on('deskRemoved', (deskId) => broadcast({ t: 'desk.removed', deskId }));
  boards.on('boardChanged', (roomId) => broadcast({ t: 'board.update', board: boards.board(roomId) }));
  summarizer.on('update', (summary) => broadcast({ t: 'summary.update', summary }));
  usage.on('usage', (next) => broadcast({ t: 'usage.update', usage: next }));
  usage.on('alert', (alert) => broadcast({ t: 'usage.alert', alert }));
  usage.on('deskStats', (deskId, stats) => broadcast({ t: 'desk.stats', deskId, stats }));

  app.get('/ws', { websocket: true }, (socket) => {
    const client = new ClientConnection(socket);
    clients.add(client);
    client.send({
      t: 'office.snapshot',
      rooms: store.listRooms(),
      desks: store.listDesks().map(toPublicDesk),
      boards: store.listRooms().map((room) => boards.board(room.id)),
      usage: usage.usage(),
      deskStats: usage.deskStats(),
    });

    socket.on('message', (raw) => {
      let parsed;
      try {
        parsed = clientMessageSchema.safeParse(JSON.parse(raw.toString()));
      } catch {
        parsed = null;
      }
      if (!parsed?.success) {
        client.send({ t: 'error', code: 'invalid_message', message: 'Invalid message.' });
        return;
      }
      const message = parsed.data;
      switch (message.t) {
        case 'term.open':
          void sessions.subscribe(message.deskId, client, message.mode).then((ok) => {
            if (ok && message.mode === 'interactive') client.interactiveDesks.add(message.deskId);
            if (!ok) client.send({ t: 'term.closed', deskId: message.deskId, reason: 'offline' });
          });
          break;
        case 'term.close':
          if (message.mode === 'interactive') client.interactiveDesks.delete(message.deskId);
          sessions.unsubscribe(message.deskId, client, message.mode);
          break;
        case 'term.input':
          if (client.interactiveDesks.has(message.deskId)) sessions.input(message.deskId, message.data);
          break;
        case 'term.resize':
          if (client.interactiveDesks.has(message.deskId)) {
            sessions.resize(message.deskId, message.cols, message.rows);
          }
          break;
        case 'ping':
          client.send({ t: 'pong' });
          break;
        case 'presence':
          presence.set(client, message.visible);
          break;
      }
    });

    socket.on('close', () => {
      clients.delete(client);
      presence.remove(client);
      sessions.unsubscribeAll(client);
    });
  });
}
