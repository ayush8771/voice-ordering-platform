import { describe, expect, it } from 'vitest';
import { classifyCartConflict } from './cartConflict';

/** `details` shapes copied from the backend's actual 409 sites. */
describe('classifyCartConflict', () => {
  it('recognises a revision conflict by its documented details', () => {
    expect(classifyCartConflict([{ revision: 7 }])).toBe('revision');
    expect(classifyCartConflict([{ revision: 0 }])).toBe('revision');
  });

  it('does not treat an unavailable item or option as a revision conflict', () => {
    expect(classifyCartConflict([{ menuItemId: 'dosa' }])).toBe('other');
    expect(classifyCartConflict([{ menuItemId: 'dosa', optionId: 'ghee' }])).toBe(
      'other',
    );
  });

  it('does not treat a quantity cap, PATCH collision or unavailable draft as one', () => {
    // Quantity cap and collision share this shape on the backend.
    expect(classifyCartConflict([{ menuItemId: 'dosa', lineId: 'l-1' }])).toBe('other');
  });

  it('does not treat a line-cap 409 (no details) as one', () => {
    expect(classifyCartConflict(undefined)).toBe('other');
    expect(classifyCartConflict([])).toBe('other');
  });

  it('rejects malformed or unknown details', () => {
    expect(classifyCartConflict([null])).toBe('other');
    expect(classifyCartConflict(['revision'])).toBe('other');
    expect(classifyCartConflict([{ revision: '7' }])).toBe('other');
    expect(classifyCartConflict([{ revision: 1.5 }])).toBe('other');
    expect(classifyCartConflict([{ revision: -1 }])).toBe('other');
    expect(classifyCartConflict([{ something: 'else' }])).toBe('other');
  });
});
