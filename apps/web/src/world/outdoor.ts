import { seededRandom } from './appearance';
import type { PropPlacement } from './decor';
import { CORRIDOR_HALF_WIDTH, type OfficeLayout, type RoomRect, type Vec2 } from './layout';
import type { PropName } from './props/propLibrary';

/**
 * Everything around the building, laid out from the floor plan so it follows the office as it grows:
 * an entrance plaza on the west, a street along it and another one behind the building, a car park,
 * the lounge's terrace, hedges along the facades, a park to the east, trees, street lamps, parked cars
 * and simple neighboring buildings. Tall things stay off the south side, between the overview camera
 * and the building.
 *
 * Scene axes: north is −Z, east is +X. The ground is at GROUND_Y, the office floor at 0.
 */

export const GROUND_Y = -0.2;
/** Tops of the raised surfaces (sidewalks and plaza have a curb). */
const PAVING_TOP = -0.08;
const APRON_TOP = -0.1;
const LOT_TOP = -0.17;
const PATH_TOP = -0.175;
const DECK_TOP = -0.04;
const ROAD_Y = GROUND_Y + 0.006;

const ROAD_WIDTH = 7;
const SIDEWALK = 2.5;
const PLAZA_DEPTH = 10;
const PLAZA_HALF_WIDTH = 4.5;
/** Paved strip along the facades. */
const APRON = 1.2;

export type SurfaceKind = 'paving' | 'apron' | 'lot' | 'path' | 'deck' | 'paint';

/** A flat box from the ground up to `top`. */
export interface Surface {
  kind: SurfaceKind;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
}

/** A road plane; `axis` is the direction it runs along. */
export interface Road {
  axis: 'x' | 'z';
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Neighbor {
  x: number;
  z: number;
  /** Size along X, along Z, and height. */
  width: number;
  depth: number;
  height: number;
  color: string;
  seed: number;
}

export interface LightPool {
  x: number;
  z: number;
  radius: number;
}

export interface Spot {
  position: Vec2;
  yaw: number;
}

export interface OutdoorLayout {
  props: PropPlacement[];
  surfaces: Surface[];
  roads: Road[];
  neighbors: Neighbor[];
  pools: LightPool[];
  sign: { x: number; y: number; z: number; rotation: number };
  terraceSpots: Spot[];
}

const FACADE_COLORS = ['#d9d2c5', '#b9c3cc', '#c9b9a6', '#9aa7b1', '#e0dcd3', '#a89f94', '#c7c1b5'];

/** Rotation making a prop (front toward +Z) face direction (dx, dz). */
const facing = (dx: number, dz: number) => Math.atan2(dx, dz);

/** Terrace of the lounge, outside its back wall (the lounge is on the south side). */
function terraceOf(lounge: RoomRect) {
  const back = lounge.towardCorridor === 1 ? lounge.z0 : lounge.z1;
  const out = -lounge.towardCorridor;
  return {
    x0: lounge.x1 - 8.0,
    x1: lounge.x1 - 0.3,
    /** z of the deck edge along the wall and of the far edge. */
    near: back + out * 0.07,
    far: back + out * 4.6,
    out,
    back,
    tables: [lounge.x1 - 6.6, lounge.x1 - 4.3, lounge.x1 - 1.2],
  };
}

/** Where characters on a coffee break can stand on the terrace. */
export function terraceSpots(layout: OfficeLayout): Spot[] {
  const lounge = layout.rooms.find((room) => room.kind === 'lounge');
  if (!lounge) return [];
  const terrace = terraceOf(lounge);
  const tableZ = terrace.back + terrace.out * 2.3;
  // Between the wall and the tables, looking out over the table toward the garden.
  return terrace.tables.slice(0, 2).map((x) => ({
    position: [x, tableZ - terrace.out * 0.95] as Vec2,
    yaw: facing(0, terrace.out),
  }));
}

export function computeOutdoor(layout: OfficeLayout): OutdoorLayout {
  const { bounds } = layout;
  const x0 = bounds.x0;
  const x1 = bounds.x1;
  const props: PropPlacement[] = [];
  const surfaces: Surface[] = [];
  const roads: Road[] = [];
  const pools: LightPool[] = [];
  const place = (model: PropName, x: number, z: number, rotation = 0, y = GROUND_Y, scale?: number) => {
    props.push({ model, x, y, z, rotation, ...(scale ? { scale } : {}) });
  };
  const lamp = (x: number, z: number, rotation: number, y = GROUND_Y) => {
    place('street_lamp', x, z, rotation, y);
    // The light head overhangs 0.95 m in front of the pole.
    pools.push({ x: x + Math.sin(rotation) * 0.95, z: z + Math.cos(rotation) * 0.95, radius: 5.5 });
  };
  const bollard = (x: number, z: number, y = GROUND_Y) => {
    place('bollard', x, z, 0, y);
    pools.push({ x, z, radius: 1.6 });
  };

  // ---- the building's surroundings: apron, hedges ------------------------------------------
  const rects = [
    ...layout.rooms,
    { x0: layout.corridor.x0, x1: layout.corridor.x1, z0: -CORRIDOR_HALF_WIDTH, z1: CORRIDOR_HALF_WIDTH },
  ];
  for (const rect of rects) {
    surfaces.push({
      kind: 'apron',
      x0: rect.x0 - APRON,
      x1: rect.x1 + APRON,
      z0: rect.z0 - APRON,
      z1: rect.z1 + APRON,
      top: APRON_TOP,
    });
  }
  const blocked: { x0: number; x1: number; z0: number; z1: number }[] = rects.map((rect) => ({
    x0: rect.x0 - APRON - 1.5,
    x1: rect.x1 + APRON + 1.5,
    z0: rect.z0 - APRON - 1.5,
    z1: rect.z1 + APRON + 1.5,
  }));
  for (const room of layout.rooms) {
    if (room.kind === 'lounge') continue;
    const back = room.towardCorridor === 1 ? room.z0 : room.z1;
    const z = back - room.towardCorridor * (APRON + 0.5);
    const sections = Math.floor((room.x1 - room.x0 - 1.2) / 2);
    const start = (room.x0 + room.x1) / 2 - sections;
    for (let i = 0; i < sections; i++) place('hedge', start + 1 + i * 2, z, 0, APRON_TOP);
  }

  // ---- entrance plaza (west end of the corridor) ------------------------------------------
  const plaza = { x0: x0 - PLAZA_DEPTH, x1: x0, z0: -PLAZA_HALF_WIDTH, z1: PLAZA_HALF_WIDTH };
  surfaces.push({ kind: 'paving', ...plaza, top: PAVING_TOP });
  blocked.push({ x0: plaza.x0 - 1, x1: plaza.x1, z0: plaza.z0 - 1, z1: plaza.z1 + 1 });
  place('entrance_canopy', x0 - 1.1, 0, facing(-1, 0), PAVING_TOP);
  pools.push({ x: x0 - 1.4, z: 0, radius: 2.4 });
  const sign = { x: x0 - 7.6, y: PAVING_TOP, z: -3.3, rotation: facing(-1, 1) };
  place('sign_monolith', sign.x, sign.z, sign.rotation, PAVING_TOP);
  place('flower_bed', x0 - 3.8, -3.6, 0, PAVING_TOP);
  place('flower_bed', x0 - 3.8, 3.6, 0.8, PAVING_TOP);
  place('flower_bed', x0 - 9.0, 3.7, 1.9, PAVING_TOP);
  place('bench', x0 - 5.6, -3.9, facing(0, 1), PAVING_TOP);
  place('bench', x0 - 6.2, 3.9, facing(0, -1), PAVING_TOP);
  place('outdoor_bin', x0 - 4.5, -4.0, 0, PAVING_TOP);
  place('bike_rack', x0 - 2.0, 3.6, Math.PI / 2, PAVING_TOP);
  lamp(x0 - 9.4, -4.0, facing(1, 0), PAVING_TOP);
  lamp(x0 - 9.4, 4.0, facing(1, 0), PAVING_TOP);
  for (const z of [-2.4, -0.8, 0.8, 2.4]) bollard(x0 - 9.7, z, PAVING_TOP);
  place('tree_birch', x0 - 6.5, -5.8);
  place('tree_birch', x0 - 3.2, -5.9, 1.3);

  // ---- streets: one along the west side, one behind the building (north) --------------------
  const zSouth = bounds.z1 + 70;
  const zNorth = bounds.z0 - 70;
  const xEast = x1 + 80;
  const westRoad = { x0: x0 - PLAZA_DEPTH - SIDEWALK - ROAD_WIDTH, x1: x0 - PLAZA_DEPTH - SIDEWALK };
  const northRoad = { z0: bounds.z0 - 20.5, z1: bounds.z0 - 20.5 + ROAD_WIDTH };
  // The south street stays flat and low: it is on the overview camera's side.
  const southRoad = { z0: bounds.z1 + 30, z1: bounds.z1 + 30 + ROAD_WIDTH };
  roads.push({ axis: 'z', x0: westRoad.x0, x1: westRoad.x1, z0: zNorth, z1: zSouth });
  roads.push({ axis: 'x', x0: westRoad.x1, x1: xEast, z0: northRoad.z0, z1: northRoad.z1 });
  roads.push({ axis: 'x', x0: westRoad.x1, x1: xEast, z0: southRoad.z0, z1: southRoad.z1 });
  const sidewalks = [
    // East side of the west street, cut by the north and south streets.
    { x0: westRoad.x1, x1: westRoad.x1 + SIDEWALK, z0: northRoad.z1, z1: southRoad.z0 },
    { x0: westRoad.x1, x1: westRoad.x1 + SIDEWALK, z0: southRoad.z1, z1: zSouth },
    { x0: westRoad.x1, x1: westRoad.x1 + SIDEWALK, z0: zNorth, z1: northRoad.z0 },
    // Both sides of the south street.
    { x0: westRoad.x1 + SIDEWALK, x1: xEast, z0: southRoad.z0 - SIDEWALK, z1: southRoad.z0 },
    { x0: westRoad.x1 + SIDEWALK, x1: xEast, z0: southRoad.z1, z1: southRoad.z1 + SIDEWALK },
    // West side of the west street.
    { x0: westRoad.x0 - SIDEWALK, x1: westRoad.x0, z0: zNorth, z1: zSouth },
    // Both sides of the north street.
    { x0: westRoad.x1 + SIDEWALK, x1: xEast, z0: northRoad.z1, z1: northRoad.z1 + SIDEWALK },
    { x0: westRoad.x1, x1: xEast, z0: northRoad.z0 - SIDEWALK, z1: northRoad.z0 },
  ];
  for (const sidewalk of sidewalks) surfaces.push({ kind: 'paving', ...sidewalk, top: PAVING_TOP });
  blocked.push({ x0: westRoad.x0 - SIDEWALK - 2, x1: westRoad.x1 + SIDEWALK + 0.5, z0: zNorth, z1: zSouth });
  blocked.push({
    x0: westRoad.x0,
    x1: xEast,
    z0: northRoad.z0 - SIDEWALK - 0.5,
    z1: northRoad.z1 + SIDEWALK + 1,
  });
  blocked.push({
    x0: westRoad.x0,
    x1: xEast,
    z0: southRoad.z0 - SIDEWALK - 1,
    z1: southRoad.z1 + SIDEWALK + 0.5,
  });

  // ---- car park, south of the plaza --------------------------------------------------------
  const lot = { x0: x0 - PLAZA_DEPTH, x1: x0 - 2, z0: 7, z1: 17 };
  surfaces.push({ kind: 'lot', ...lot, top: LOT_TOP });
  blocked.push({ x0: lot.x0 - 1, x1: lot.x1 + 1, z0: lot.z0 - 1, z1: lot.z1 + 1.5 });
  for (let i = 0; i <= 4; i++) {
    const z = lot.z0 + i * 2.5;
    surfaces.push({
      kind: 'paint',
      x0: lot.x1 - 5,
      x1: lot.x1,
      z0: z - 0.05,
      z1: z + 0.05,
      top: LOT_TOP + 0.004,
    });
  }
  const random = seededRandom(97);
  const cars: PropName[] = ['car_red', 'car_blue', 'car_white'];
  for (let i = 0; i < 4; i++) {
    if (i === 2) continue;
    place(cars[i % cars.length]!, lot.x1 - 2.6, lot.z0 + 1.25 + i * 2.5, facing(1, 0), LOT_TOP);
  }
  // Low lights only: the car park is on the side of the overview camera.
  for (const z of [lot.z0 + 1, lot.z1 - 1]) bollard(lot.x1 + 0.5, z);
  for (let x = lot.x0 + 1; x + 2 <= lot.x1 + 0.01; x += 2) place('hedge', x, lot.z1 + 0.8);

  // Parked cars along the streets, lamps and street trees on the sidewalks.
  // Not in front of the plaza and the car park, nor across the south street.
  const inFront = (z: number) =>
    (z > -PLAZA_HALF_WIDTH - 3 && z < lot.z1 + 2) || (z > southRoad.z0 - 3 && z < southRoad.z1 + 3);
  for (let z = northRoad.z1 + 8; z < zSouth - 5; z += 14) {
    if (!inFront(z)) lamp(westRoad.x1 + 0.6, z, facing(-1, 0), PAVING_TOP);
    if (!inFront(z + 7)) {
      place(
        random() < 0.5 ? 'tree_round' : 'tree_birch',
        westRoad.x1 + 1.3,
        z + 7,
        random() * 6,
        PAVING_TOP,
        0.85 + random() * 0.3,
      );
    }
    if (!inFront(z + 3.5)) lamp(westRoad.x0 - 0.6, z + 3.5, facing(1, 0), PAVING_TOP);
    if (random() < 0.45 && !inFront(z + 3)) {
      place(cars[Math.floor(random() * 3)]!, westRoad.x1 - 1.05, z + 3, facing(0, -1), ROAD_Y);
    }
    if (random() < 0.35 && !inFront(z + 10)) {
      place(cars[Math.floor(random() * 3)]!, westRoad.x0 + 1.05, z + 10, facing(0, 1), ROAD_Y);
    }
  }
  for (let x = westRoad.x1 + 10; x < xEast - 5; x += 16) {
    lamp(x, southRoad.z0 - 0.6, facing(0, 1), PAVING_TOP);
    if (random() < 0.35)
      place(cars[Math.floor(random() * 3)]!, x + 6, southRoad.z0 + 1.05, facing(-1, 0), ROAD_Y);
  }
  for (let x = westRoad.x1 + 6; x < xEast - 5; x += 14) {
    lamp(x, northRoad.z1 + 0.6, facing(0, -1), PAVING_TOP);
    place(
      random() < 0.6 ? 'tree_round' : 'tree_birch',
      x + 7,
      northRoad.z1 + 1.3,
      random() * 6,
      PAVING_TOP,
      0.85 + random() * 0.3,
    );
    if (random() < 0.4)
      place(cars[Math.floor(random() * 3)]!, x + 3, northRoad.z1 - 1.05, facing(1, 0), ROAD_Y);
  }

  // ---- terrace of the lounge -----------------------------------------------------------------
  const lounge = layout.rooms.find((room) => room.kind === 'lounge');
  const terraceSpotList = terraceSpots(layout);
  if (lounge) {
    const terrace = terraceOf(lounge);
    surfaces.push({
      kind: 'deck',
      x0: terrace.x0,
      x1: terrace.x1,
      z0: Math.min(terrace.near, terrace.far),
      z1: Math.max(terrace.near, terrace.far),
      top: DECK_TOP,
    });
    const tableZ = terrace.back + terrace.out * 2.3;
    for (const x of terrace.tables) {
      place('outdoor_table', x, tableZ, 0, DECK_TOP);
      // On the table's base (their bases would share side faces), the pole through the top.
      place('parasol', x, tableZ, 0, DECK_TOP + 0.03);
      place('outdoor_chair', x - 0.75, tableZ, facing(1, 0), DECK_TOP);
      place('outdoor_chair', x + 0.75, tableZ, facing(-1, 0), DECK_TOP);
    }
    place('flower_bed', terrace.x0 + 0.7, terrace.far - terrace.out * 0.7, 0, DECK_TOP);
    place('flower_bed', terrace.x1 - 0.7, terrace.far - terrace.out * 0.7, 2, DECK_TOP);
    bollard(terrace.x0 + 0.3, terrace.near + terrace.out * 0.4, DECK_TOP);
    bollard(terrace.x1 - 0.3, terrace.near + terrace.out * 0.4, DECK_TOP);
    blocked.push({
      x0: terrace.x0 - 1,
      x1: terrace.x1 + 1,
      z0: Math.min(terrace.near, terrace.far) - 1,
      z1: Math.max(terrace.near, terrace.far) + 2,
    });
  }

  // ---- park to the east ------------------------------------------------------------------------
  const park = { x0: x1 + APRON + 3, x1: x1 + 34, z0: bounds.z0 - 9, z1: bounds.z1 + 2 };
  const crossX = (park.x0 + park.x1) / 2;
  surfaces.push({ kind: 'path', x0: x1 + APRON, x1: park.x1, z0: -0.8, z1: 0.8, top: PATH_TOP });
  surfaces.push({
    kind: 'path',
    x0: crossX - 0.8,
    x1: crossX + 0.8,
    z0: park.z0,
    z1: park.z1,
    top: PATH_TOP,
  });
  blocked.push({ x0: x1, x1: park.x1, z0: -2.2, z1: 2.2 });
  blocked.push({ x0: crossX - 2.2, x1: crossX + 2.2, z0: park.z0, z1: park.z1 });
  for (let x = park.x0 + 2; x < park.x1; x += 7) {
    bollard(x, -1.2, PATH_TOP);
    bollard(x + 3.5, 1.2, PATH_TOP);
  }
  place('bench', park.x0 + 6, 1.9, facing(0, -1));
  place('bench', park.x1 - 6, -1.9, facing(0, 1));
  place('bench', crossX - 1.9, park.z0 + 6, facing(1, 0));
  place('outdoor_bin', park.x0 + 7.4, 1.8);
  place('flower_bed', crossX - 2.4, -2.4);
  place('flower_bed', crossX + 2.4, 2.4, 1);

  // ---- scattered trees and bushes ----------------------------------------------------------------
  const occupied: Vec2[] = props.map((prop) => [prop.x, prop.z]);
  const free = (x: number, z: number, spacing: number) =>
    !blocked.some((area) => x > area.x0 && x < area.x1 && z > area.z0 && z < area.z1) &&
    occupied.every(([ox, oz]) => Math.hypot(ox - x, oz - z) > spacing);
  const scatter = (
    area: { x0: number; x1: number; z0: number; z1: number },
    count: number,
    spacing: number,
    models: PropName[],
    seed: number,
  ) => {
    const rng = seededRandom(seed);
    for (let placed = 0, attempts = 0; placed < count && attempts < count * 30; attempts++) {
      const x = area.x0 + rng() * (area.x1 - area.x0);
      const z = area.z0 + rng() * (area.z1 - area.z0);
      if (!free(x, z, spacing)) continue;
      place(
        models[Math.floor(rng() * models.length)]!,
        x,
        z,
        rng() * Math.PI * 2,
        GROUND_Y,
        0.8 + rng() * 0.45,
      );
      occupied.push([x, z]);
      placed++;
    }
  };
  const tall: PropName[] = ['tree_round', 'tree_birch', 'tree_conifer'];
  // Behind the building (north), between it and the north street.
  scatter(
    { x0: x0 - 6, x1: x1 + 4, z0: northRoad.z1 + SIDEWALK + 1, z1: bounds.z0 - 3 },
    Math.round((x1 - x0) / 5),
    4.5,
    tall,
    11,
  );
  // The park.
  scatter(park, 26, 4.2, ['tree_round', 'tree_round', 'tree_birch', 'tree_conifer', 'bush'], 23);
  // Beyond the north street, in front of the neighbors.
  scatter(
    { x0: westRoad.x1, x1: xEast - 10, z0: northRoad.z0 - SIDEWALK - 4, z1: northRoad.z0 - SIDEWALK - 0.5 },
    8,
    6,
    ['tree_conifer', 'tree_round'],
    31,
  );
  // South side, in front of the overview camera: only low vegetation, in beds of a few shrubs.
  const beds = seededRandom(47);
  for (let placed = 0, attempts = 0; placed < Math.round((x1 - x0) / 8) && attempts < 300; attempts++) {
    const cx = x0 - 4 + beds() * (x1 - x0 + 6);
    const cz = bounds.z1 + APRON + 4 + beds() * 18;
    if (!free(cx, cz, 5)) continue;
    place('flower_bed', cx, cz, beds() * 6);
    occupied.push([cx, cz]);
    for (let i = 0, count = 2 + Math.floor(beds() * 3); i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + beds();
      const bush: Vec2 = [cx + Math.cos(angle) * 1.5, cz + Math.sin(angle) * 1.5];
      place('bush', bush[0], bush[1], beds() * 6, GROUND_Y, 0.7 + beds() * 0.5);
      occupied.push(bush);
    }
    placed++;
  }

  // ---- neighboring buildings -----------------------------------------------------------------------
  const neighbors: Neighbor[] = [];
  const addRow = (
    along: 'x' | 'z',
    from: number,
    to: number,
    front: number,
    direction: 1 | -1,
    seed: number,
    maxHeight: (center: number) => number = () => Infinity,
  ) => {
    const rng = seededRandom(seed);
    let cursor = from;
    let index = 0;
    while (cursor < to) {
      const length = 12 + rng() * 12;
      const depth = 14 + rng() * 10;
      const center = cursor + length / 2;
      const height = Math.min(8 + Math.floor(rng() * 6) * 3.2, maxHeight(center));
      const back = front + (direction * depth) / 2;
      neighbors.push({
        x: along === 'z' ? back : center,
        z: along === 'z' ? center : back,
        width: along === 'z' ? depth : length,
        depth: along === 'z' ? length : depth,
        height,
        color: FACADE_COLORS[Math.floor(rng() * FACADE_COLORS.length)]!,
        seed: seed * 1000 + index++,
      });
      cursor += length + 4 + rng() * 5;
    }
  };
  // West of the west street, north of the north street, east of the park.
  // The west row stops short of the south street and gets lower on the overview camera's side.
  addRow('z', zNorth + 10, bounds.z1 + 12, westRoad.x0 - SIDEWALK - 2, -1, 5, (z) =>
    z > 0 ? 14.4 : Infinity,
  );
  addRow('x', westRoad.x1 + 4, xEast, northRoad.z0 - SIDEWALK - 7, -1, 7);
  addRow('z', northRoad.z1 + SIDEWALK + 4, bounds.z1 + 10, park.x1 + 8, 1, 13);

  return { props, surfaces, roads, neighbors, pools, sign, terraceSpots: terraceSpotList };
}
