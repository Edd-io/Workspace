import { create } from 'zustand';
import {
  ATTENTION_STATES,
  type Desk,
  type DeskStats,
  type OfficeSummary,
  type Room,
  type RoomBoard,
  type ServerMessage,
  type SubscriptionUsage,
  type UsageAlert,
} from '@workspace/shared';
import { officeSocket, type ConnectionStatus } from '../api/socket';

export type Panel =
  | { kind: 'createRoom' }
  | { kind: 'createDesk'; roomId: string }
  | { kind: 'board'; roomId: string }
  | { kind: 'inbox' }
  | { kind: 'summary' }
  | { kind: 'map' }
  | { kind: 'timeline' }
  | { kind: 'integrate'; deskId: string }
  | { kind: 'notifications' }
  | null;

/** Short-lived in-app notification: a desk started waiting for the human, or usage is running out. */
export type Toast =
  { id: number; deskId: string; usage?: undefined } | { id: number; usage: UsageAlert; deskId?: undefined };

export type ViewMode = 'overview' | 'walk';

interface OfficeState {
  connection: ConnectionStatus;
  loaded: boolean;
  rooms: Record<string, Room>;
  desks: Record<string, Desk>;
  boards: Record<string, RoomBoard>;
  summary: OfficeSummary | null;
  /** Claude subscription usage (shared by every desk). */
  usage: SubscriptionUsage | null;
  /** Live figures of each desk's session (model, context size). */
  deskStats: Record<string, DeskStats>;
  toasts: Toast[];
  /** Desk the camera is looking at. */
  focusedDeskId: string | null;
  /** Desk whose terminal overlay is open. */
  terminalDeskId: string | null;
  panel: Panel;
  viewMode: ViewMode;
  sidebarCollapsed: boolean;
  /** Development only: hour of the day forced for the day/night cycle (null: the real clock). */
  clockOverride: number | null;
  /** Pending request to move the view to a floor point (minimap clicks, teleports). */
  viewTarget: { x: number; z: number; yaw?: number; seq: number } | null;
  focusDesk: (deskId: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  goTo: (x: number, z: number, yaw?: number) => void;
  setSummary: (summary: OfficeSummary) => void;
  pushToast: (deskId: string) => void;
  pushUsageToast: (alert: UsageAlert) => void;
  dismissToast: (id: number) => void;
  openTerminal: (deskId: string) => void;
  closeTerminal: () => void;
  setPanel: (panel: Panel) => void;
}

export const useOffice = create<OfficeState>((set) => ({
  connection: 'closed',
  loaded: false,
  rooms: {},
  desks: {},
  boards: {},
  summary: null,
  usage: null,
  deskStats: {},
  clockOverride: null,
  toasts: [],
  focusedDeskId: null,
  terminalDeskId: null,
  panel: null,
  viewMode: 'overview',
  sidebarCollapsed: false,
  viewTarget: null,
  focusDesk: (deskId) => set({ focusedDeskId: deskId }),
  setViewMode: (viewMode) =>
    set((state) => ({
      viewMode,
      focusedDeskId: null,
      sidebarCollapsed: viewMode === 'walk' ? true : state.sidebarCollapsed,
    })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setSummary: (summary) => set({ summary }),
  pushToast: (deskId) =>
    set((state) => ({
      toasts: [
        ...state.toasts.filter((toast) => toast.deskId !== deskId),
        { id: Date.now() + Math.random(), deskId },
      ].slice(-4),
    })),
  pushUsageToast: (alert) =>
    set((state) => ({
      toasts: [
        ...state.toasts.filter((toast) => toast.usage?.window !== alert.window),
        { id: Date.now() + Math.random(), usage: alert },
      ].slice(-4),
    })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  goTo: (x, z, yaw) =>
    set((state) => ({
      viewTarget: { x, z, yaw, seq: (state.viewTarget?.seq ?? 0) + 1 },
      focusedDeskId: null,
    })),
  openTerminal: (deskId) => set({ focusedDeskId: deskId, terminalDeskId: deskId }),
  closeTerminal: () => set({ terminalDeskId: null }),
  setPanel: (panel) => set({ panel }),
}));

if (import.meta.env.DEV) {
  // Handle for automated browser checks during development.
  (window as unknown as { __office?: unknown }).__office = {
    goTo: (x: number, z: number, yaw?: number) => useOffice.getState().goTo(x, z, yaw),
    setHour: (hour: number | null) => useOffice.setState({ clockOverride: hour }),
  };
}

function applyMessage(message: ServerMessage): void {
  switch (message.t) {
    case 'office.snapshot':
      useOffice.setState({
        loaded: true,
        rooms: Object.fromEntries(message.rooms.map((room) => [room.id, room])),
        desks: Object.fromEntries(message.desks.map((desk) => [desk.id, desk])),
        boards: Object.fromEntries(message.boards.map((board) => [board.roomId, board])),
        usage: message.usage,
        deskStats: message.deskStats,
      });
      break;
    case 'usage.update':
      useOffice.setState({ usage: message.usage });
      break;
    case 'usage.alert':
      for (const listener of usageAlertListeners) listener(message.alert);
      break;
    case 'desk.stats':
      useOffice.setState((state) => ({ deskStats: { ...state.deskStats, [message.deskId]: message.stats } }));
      break;
    case 'summary.update':
      useOffice.setState({ summary: message.summary });
      break;
    case 'board.update':
      useOffice.setState((state) => ({ boards: { ...state.boards, [message.board.roomId]: message.board } }));
      break;
    case 'room.upsert':
      useOffice.setState((state) => ({ rooms: { ...state.rooms, [message.room.id]: message.room } }));
      break;
    case 'room.removed':
      useOffice.setState((state) => {
        const { [message.roomId]: _removed, ...rooms } = state.rooms;
        return { rooms };
      });
      break;
    case 'desk.upsert':
      useOffice.setState((state) => ({ desks: { ...state.desks, [message.desk.id]: message.desk } }));
      break;
    case 'desk.removed':
      useOffice.setState((state) => {
        const { [message.deskId]: _removed, ...desks } = state.desks;
        return {
          desks,
          focusedDeskId: state.focusedDeskId === message.deskId ? null : state.focusedDeskId,
          terminalDeskId: state.terminalDeskId === message.deskId ? null : state.terminalDeskId,
        };
      });
      break;
    default:
      break;
  }
}

const usageAlertListeners = new Set<(alert: UsageAlert) => void>();

/** Usage alerts are events, not state: the notification layer subscribes here. */
export function onUsageAlert(listener: (alert: UsageAlert) => void): () => void {
  usageAlertListeners.add(listener);
  return () => usageAlertListeners.delete(listener);
}

let started = false;

/** Connects the store to the server's realtime feed (idempotent). */
export function startOfficeSync(): void {
  if (started) return;
  started = true;
  officeSocket.onMessage(applyMessage);
  // The server sends phone notifications only when no tab is visible.
  const reportPresence = () =>
    officeSocket.send({ t: 'presence', visible: document.visibilityState === 'visible' });
  officeSocket.onStatus((connection) => {
    useOffice.setState({ connection });
    if (connection === 'open') reportPresence();
  });
  document.addEventListener('visibilitychange', reportPresence);
  officeSocket.start();
}

export function stopOfficeSync(): void {
  officeSocket.stop();
}

export function sortedRooms(rooms: Record<string, Room>): Room[] {
  return Object.values(rooms).sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
}

export function desksOfRoom(desks: Record<string, Desk>, roomId: string): Desk[] {
  return Object.values(desks)
    .filter((desk) => desk.roomId === roomId)
    .sort((a, b) => a.position - b.position);
}

/** Desks waiting for the human, oldest first. */
export function attentionDesks(desks: Record<string, Desk>): Desk[] {
  return Object.values(desks)
    .filter((desk) => ATTENTION_STATES.has(desk.state))
    .sort((a, b) => a.stateSince - b.stateSince);
}
