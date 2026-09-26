import type { Desk, Room } from '@workspace/shared';
import { sortedRooms, useOffice } from '../state/officeStore';
import { officeProps, type PropPlacement } from './decor';
import { computeLayout, type OfficeLayout } from './layout';

/** Only what changes the floor plan; desk state changes must not rebuild the world. */
function structureKey(rooms: Record<string, Room>, desks: Record<string, Desk>): string {
  const roomPart = sortedRooms(rooms)
    .map((room) => `${room.id}:${room.name}:${room.accentColor}:${room.position}`)
    .join('|');
  const deskPart = Object.values(desks)
    .map((desk) => `${desk.id}:${desk.roomId}:${desk.position}:${desk.appearanceSeed}`)
    .sort()
    .join('|');
  return `${roomPart}#${deskPart}`;
}

let cache: { key: string; layout: OfficeLayout; props: PropPlacement[] } | null = null;

function layoutFor(rooms: Record<string, Room>, desks: Record<string, Desk>) {
  const key = structureKey(rooms, desks);
  if (!cache || cache.key !== key) {
    const layout = computeLayout(sortedRooms(rooms), Object.values(desks));
    cache = { key, layout, props: officeProps(layout) };
  }
  return cache;
}

/**
 * Floor plan of the current office, shared by the 3D world and the minimap. Desk objects inside it
 * may be stale: read live desk data from the store by id.
 */
export function useOfficeLayout(): OfficeLayout {
  const rooms = useOffice((state) => state.rooms);
  const desks = useOffice((state) => state.desks);
  return layoutFor(rooms, desks).layout;
}

export function useOfficeProps(): PropPlacement[] {
  const rooms = useOffice((state) => state.rooms);
  const desks = useOffice((state) => state.desks);
  return layoutFor(rooms, desks).props;
}
