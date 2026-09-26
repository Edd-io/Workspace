import type { TFunction } from 'i18next';

/** Roles a desk can take in its room; the texts live in the locale files (`roles.<id>`). */
export const ROLE_IDS = ['lead', 'developer', 'frontend', 'backend', 'tests', 'reviewer', 'docs'] as const;
export type RoleId = (typeof ROLE_IDS)[number];

/** Desks created with a new room. */
export const ROOM_TEMPLATES = {
  empty: [],
  solo: ['developer'],
  duo: ['developer', 'reviewer'],
  team: ['lead', 'frontend', 'backend', 'tests'],
} as const satisfies Record<string, readonly RoleId[]>;
export type RoomTemplateId = keyof typeof ROOM_TEMPLATES;
export const ROOM_TEMPLATE_IDS = Object.keys(ROOM_TEMPLATES) as RoomTemplateId[];

/**
 * The role text stored on a desk, in the viewer's language: shown in the office and given to the
 * desk's Claude session as its responsibility in the room.
 */
export function roleText(t: TFunction, role: RoleId): string {
  return `${t(`roles.${role}.label`)} — ${t(`roles.${role}.description`)}`;
}

/** Short form of a role for the office (the part before the dash). */
export function roleLabel(role: string): string {
  return role.split(' — ')[0]!.trim();
}
