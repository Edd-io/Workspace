import type { Desk, DeskState } from '@workspace/shared';
import { useEffect, useMemo } from 'react';
import { useOffice } from '../state/officeStore';
import { loungeSpots, SEAT, type PropPlacement } from './decor';
import { deskToWorld, type OfficeLayout, type Vec2 } from './layout';
import { NavGrid } from './navigation';
import { terraceSpots } from './outdoor';
import {
  interruptTrip,
  planTrip,
  tripClock,
  tripPose,
  useTrips,
  type TripClip,
  type TripPurpose,
} from './trips';

/** How often idle desks may decide to take a break. */
const BREAK_CHECK_MS = 10_000;
/** A desk must have been idle that long before a coffee break. */
const IDLE_BEFORE_BREAK_MS = 2 * 60_000;
/** Minimum time between two trips of the same character (s). */
const BREAK_COOLDOWN_S = 20 * 60;
const BREAK_CHANCE = 0.06;
const MAX_BREAKS = 2;
/** Messages older than this when they arrive (a reconnection) do not send anyone walking. */
const FRESH_MESSAGE_MS = 60_000;
/** States in which a character on an errand still hurries back: its session needs the human. */
const NEEDS_HUMAN = new Set<DeskState>(['question', 'error', 'limited']);

interface Seat {
  position: Vec2;
  yaw: number;
}

interface Destination {
  position: Vec2;
  yaw: number;
}

/**
 * Decides when characters leave their desk: coffee breaks for long-idle desks, a walk to the colleague
 * a desk sends a message to, a walk to the whiteboard when a desk posts a note or writes to the whole
 * room. Everyone hurries back as soon as their session needs them.
 */
export function CharacterLife({ layout, props }: { layout: OfficeLayout; props: PropPlacement[] }) {
  const grid = useMemo(() => new NavGrid(layout, props), [layout, props]);
  const seats = useMemo(() => {
    const map = new Map<string, Seat>();
    for (const entry of layout.desks) {
      const [x, , z] = deskToWorld(entry, SEAT);
      map.set(entry.desk.id, { position: [x, z], yaw: entry.rotation + Math.PI });
    }
    return map;
  }, [layout]);

  useEffect(() => {
    const lounge = layout.rooms.find((room) => room.kind === 'lounge');
    // The lounge and its terrace, outside.
    const spots = [...(lounge ? loungeSpots(lounge) : []), ...terraceSpots(layout)];

    const start = (
      deskId: string,
      purpose: TripPurpose,
      to: Destination,
      clip: TripClip,
      duration: number,
    ) => {
      const seat = seats.get(deskId);
      if (!seat || useTrips.getState().trips[deskId]) return;
      const outbound = grid.findPath(seat.position, to.position);
      if (!outbound) return;
      useTrips.getState().start(
        planTrip({
          deskId,
          purpose,
          now: tripClock(),
          seatYaw: seat.yaw,
          outbound,
          back: [...outbound].reverse(),
          stay: { yaw: to.yaw, clip, duration },
        }),
      );
    };

    // ---- coffee breaks ----------------------------------------------------------------------
    const takeBreaks = () => {
      const { desks } = useOffice.getState();
      const { trips, lastTrip } = useTrips.getState();
      const now = tripClock();
      const onBreak = Object.values(trips).filter((trip) => trip.purpose === 'coffee' && !trip.returning);
      if (onBreak.length >= MAX_BREAKS || spots.length === 0) return;
      const candidates = Object.values(desks).filter(
        (desk) =>
          desk.state === 'idle' &&
          Date.now() - desk.stateSince > IDLE_BEFORE_BREAK_MS &&
          !trips[desk.id] &&
          now - (lastTrip[desk.id] ?? -Infinity) > BREAK_COOLDOWN_S,
      );
      const desk = candidates[Math.floor(Math.random() * candidates.length)];
      if (!desk || Math.random() > BREAK_CHANCE) return;
      const taken = Object.values(trips).map((trip) => trip.destination);
      const spot = [...spots]
        .sort(() => Math.random() - 0.5)
        .find(
          (candidate) =>
            !taken.some(
              (point) => Math.hypot(point[0] - candidate.position[0], point[1] - candidate.position[1]) < 0.6,
            ),
        );
      if (spot) start(desk.id, 'coffee', spot, 'StandDrink', 25 + Math.random() * 25);
    };
    const timer = window.setInterval(takeBreaks, BREAK_CHECK_MS);

    // ---- errands: messages and notes ----------------------------------------------------------
    const seen = new Map<string, number>();
    const whiteboardSpot = (roomId: string): Destination | null => {
      const room = layout.projectRooms.find((entry) => entry.room.id === roomId);
      if (!room) return null;
      const toward = room.towardCorridor;
      return {
        position: [room.whiteboard.x + 0.3, room.whiteboard.z + toward * 1.1],
        yaw: Math.atan2(0, -toward),
      };
    };
    const colleagueSpot = (deskId: string): Destination | null => {
      const entry = layout.desks.find((candidate) => candidate.desk.id === deskId);
      const seat = seats.get(deskId);
      if (!entry || !seat) return null;
      const [x, , z] = deskToWorld(entry, [0.8, 0, 1.05]);
      return { position: [x, z], yaw: Math.atan2(seat.position[0] - x, seat.position[1] - z) };
    };
    const isFresh = (createdAt: number) => Date.now() - createdAt < FRESH_MESSAGE_MS;
    const live = (desk: Desk | undefined) => !!desk && desk.state !== 'offline';

    const onBoards = (state: ReturnType<typeof useOffice.getState>) => {
      for (const board of Object.values(state.boards)) {
        const items = [
          ...board.messages.map((message) => ({ id: message.id, kind: 'message' as const, message })),
          ...board.notes.map((note) => ({ id: note.id, kind: 'note' as const, note })),
        ];
        for (const kind of ['message', 'note'] as const) {
          const key = `${board.roomId}:${kind}`;
          const ids = items.filter((item) => item.kind === kind).map((item) => item.id);
          const last = seen.get(key);
          const newest = Math.max(0, ...ids);
          seen.set(key, Math.max(last ?? 0, newest));
          // The first snapshot only records where things stand.
          if (last === undefined) continue;
          for (const item of items) {
            if (item.kind !== kind || item.id <= last) continue;
            if (item.kind === 'message') {
              const { message } = item;
              if (
                !message.fromDeskId ||
                !live(state.desks[message.fromDeskId]) ||
                !isFresh(message.createdAt)
              )
                continue;
              const to = message.toDeskId ? colleagueSpot(message.toDeskId) : whiteboardSpot(board.roomId);
              if (to)
                start(
                  message.fromDeskId,
                  message.toDeskId ? 'visit' : 'board',
                  to,
                  message.toDeskId ? 'Talk' : 'Stand',
                  message.toDeskId ? 7 : 5,
                );
            } else {
              const { note } = item;
              if (!note.deskId || !live(state.desks[note.deskId]) || !isFresh(note.createdAt)) continue;
              const to = whiteboardSpot(board.roomId);
              if (to) start(note.deskId, 'board', to, 'Stand', 5);
            }
          }
        }
      }
    };
    onBoards(useOffice.getState());

    // ---- back to the desk when needed ---------------------------------------------------------
    const onDesks = (state: ReturnType<typeof useOffice.getState>) => {
      const { trips } = useTrips.getState();
      const now = tripClock();
      for (const trip of Object.values(trips)) {
        const desk = state.desks[trip.deskId];
        const seat = seats.get(trip.deskId);
        if (!desk || desk.state === 'offline' || !seat) {
          useTrips.getState().finish(trip.deskId, now);
          continue;
        }
        const needed = trip.purpose === 'coffee' ? desk.state !== 'idle' : NEEDS_HUMAN.has(desk.state);
        if (!needed || trip.returning) continue;
        const pose = tripPose(trip, now);
        if (!pose) continue;
        const back = grid.findPath([pose.x, pose.z], seat.position);
        if (back) useTrips.getState().replace(interruptTrip(trip, now, back, seat.yaw));
      }
    };
    onDesks(useOffice.getState());

    if (import.meta.env.DEV) {
      // Handles for automated browser checks: start a trip right away.
      (window as unknown as { __trips?: unknown }).__trips = {
        coffee: (deskId: string) => spots[0] && start(deskId, 'coffee', spots[0], 'StandDrink', 30),
        visit: (deskId: string, colleagueId: string) => {
          const to = colleagueSpot(colleagueId);
          if (to) start(deskId, 'visit', to, 'Talk', 7);
        },
        board: (deskId: string, roomId: string) => {
          const to = whiteboardSpot(roomId);
          if (to) start(deskId, 'board', to, 'Stand', 5);
        },
        state: () => useTrips.getState().trips,
      };
    }

    const unsubscribe = useOffice.subscribe((state, previous) => {
      if (state.boards !== previous.boards) onBoards(state);
      if (state.desks !== previous.desks) onDesks(state);
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [grid, layout, seats]);

  return null;
}
