import type { ClientMessage, ServerMessage, TerminalMode } from '@workspace/shared';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

type Listener = (message: ServerMessage) => void;

const PING_INTERVAL_MS = 25_000;
const MAX_BACKOFF_MS = 10_000;

/**
 * Single WebSocket to the server. Reconnects with backoff and restores terminal subscriptions
 * (previews and interactive terminals) after a reconnection.
 */
class OfficeSocket {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  /** Reference counts of terminal subscriptions, per desk and mode. */
  private readonly subscriptions = new Map<string, number>();
  private backoff = 500;
  private pingTimer: number | null = null;
  private stopped = true;
  status: ConnectionStatus = 'closed';

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private connect(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket = socket;
    this.setStatus('connecting');

    socket.onopen = () => {
      this.backoff = 500;
      this.setStatus('open');
      for (const key of this.subscriptions.keys()) {
        const [mode, deskId] = splitKey(key);
        this.sendRaw({ t: 'term.open', deskId, mode });
      }
      this.pingTimer = window.setInterval(() => this.sendRaw({ t: 'ping' }), PING_INTERVAL_MS);
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      for (const listener of this.listeners) listener(message);
    };
    socket.onclose = () => {
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.socket === socket) this.socket = null;
      this.setStatus('closed');
      if (this.stopped) return;
      window.setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    };
  }

  private sendRaw(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  send(message: ClientMessage): void {
    this.sendRaw(message);
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Subscribes to a desk terminal; returns the unsubscribe function. Counted per desk and mode. */
  openTerminal(deskId: string, mode: TerminalMode): () => void {
    const key = `${mode}:${deskId}`;
    const count = this.subscriptions.get(key) ?? 0;
    this.subscriptions.set(key, count + 1);
    if (count === 0) this.sendRaw({ t: 'term.open', deskId, mode });
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      const remaining = (this.subscriptions.get(key) ?? 1) - 1;
      if (remaining > 0) {
        this.subscriptions.set(key, remaining);
      } else {
        this.subscriptions.delete(key);
        this.sendRaw({ t: 'term.close', deskId, mode });
      }
    };
  }
}

function splitKey(key: string): [TerminalMode, string] {
  const index = key.indexOf(':');
  return [key.slice(0, index) as TerminalMode, key.slice(index + 1)];
}

export const officeSocket = new OfficeSocket();
