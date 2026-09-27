import { describe, expect, it } from 'vitest';
import type { Desk, Room } from '@workspace/shared';
import { masterDeskPose, officeProps } from './decor';
import { computeLayout } from './layout';
import { aimedSeat, seatsOf } from './seats';

const room: Room = {
  id: 'a',
  name: 'a',
  projectPath: '/p/a',
  isGitRepo: true,
  accentColor: '#e07a5f',
  position: 0,
  createdAt: 0,
  autoWake: true,
  worktreeFiles: [],
};

const desk = { id: 'd', roomId: 'a', position: 0, appearanceSeed: 1 } as Desk;

describe('seats', () => {
  const layout = computeLayout([room], [desk]);
  const props = officeProps(layout);
  const seats = seatsOf(props);
  const master = layout.rooms.find((entry) => entry.kind === 'master')!;
  const pose = masterDeskPose(master);

  it('offers the master chair but leaves desk chairs to the characters', () => {
    const chairs = props.filter((prop) => prop.model === 'office_chair');
    expect(chairs.length).toBe(2);
    const onChairs = seats.filter((seat) =>
      chairs.some((chair) => Math.hypot(chair.x - seat.target[0], chair.z - seat.target[2]) < 0.1),
    );
    expect(onChairs).toHaveLength(1);
    const [seat] = onChairs;
    // Seated at the desk, facing it, eyes above the monitors' base.
    const toDesk = [pose.x - seat!.eye[0], pose.z - seat!.eye[2]];
    const looking = [-Math.sin(seat!.yaw!), -Math.cos(seat!.yaw!)];
    expect(Math.hypot(toDesk[0]!, toDesk[1]!)).toBeLessThan(1);
    expect(toDesk[0]! * looking[0]! + toDesk[1]! * looking[1]!).toBeGreaterThan(0.6);
    expect(seat!.eye[1]).toBeGreaterThan(1.1);
    expect(seat!.eye[1]).toBeLessThan(1.35);
  });

  it('seats two on a sofa and finds the seat the viewer looks at', () => {
    const sofa = props.find((prop) => prop.model === 'sofa')!;
    const onSofa = seats.filter((seat) => Math.hypot(sofa.x - seat.target[0], sofa.z - seat.target[2]) < 1);
    expect(onSofa).toHaveLength(2);
    const seat = onSofa[0]!;
    const eye: [number, number, number] = [seat.target[0] + 1.2, 1.62, seat.target[2] + 0.5];
    const direction = seat.target.map((value, index) => value - eye[index]!);
    const length = Math.hypot(...direction);
    const aimed = aimedSeat(
      seats,
      eye,
      direction.map((value) => value / length) as [number, number, number],
      3.2,
    );
    expect(aimed?.seat).toBe(seat);
    expect(aimedSeat(seats, eye, [0, 1, 0], 3.2)).toBeNull();
  });
});
