import { describe, expect, it } from 'vitest';
import { declaredTask } from '../src/http/officeRoutes.ts';

describe('declaredTask', () => {
  it('clears the task on an empty string, or on the quotes of one', () => {
    expect(declaredTask('Add pagination')).toBe('Add pagination');
    expect(declaredTask('')).toBeNull();
    expect(declaredTask('""')).toBeNull();
    expect(declaredTask("''")).toBeNull();
    expect(declaredTask('"Quoted title"')).toBe('"Quoted title"');
  });
});
