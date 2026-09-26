import { create } from 'zustand';
import type { Desk, Room, RoomBoard, ServerMessage } from '@workspace/shared';
import { officeSocket, type ConnectionStatus } from '../api/socket';

export type Panel =
  { kind: 'createRoom' } | { kind: 'createDesk'; roomId: string } | { kind: 'board'; roomId: string } | null;

export type ViewMode = 'overview' | 'walk';

interface OfficeState {
  connection: ConnectionStatus;
  loaded: boolean;
  rooms: Record<string, Room>;
  desks: Record<string, Desk>;
  boards: Record<string, RoomBoard>;
  /** Desk the camera is looking at. */
  focusedDeskId: string | null;
  /** Desk whose terminal overlay is open. */
  terminalDeskId: string | null;
  panel: Panel;
  viewMode: ViewMode;
  sidebarCollapsed: boolean;
  /** Pending request to move the view to a floor point (minimap clicks, teleports). */
  viewTarget: { x: number; z: number; yaw?: number; seq: number } | null;
  focusDesk: (deskId: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  goTo: (x: number, z: number, yaw?: number) => void;
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
      });
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

let started = false;

/** Connects the store to the server's realtime feed (idempotent). */
export function startOfficeSync(): void {
  if (started) return;
  started = true;
  officeSocket.onMessage(applyMessage);
  officeSocket.onStatus((connection) => useOffice.setState({ connection }));
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
