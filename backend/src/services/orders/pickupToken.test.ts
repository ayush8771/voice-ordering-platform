/**
 * Pickup-token windows: the outlet's timezone decides the day, not the
 * server's, and an outlet without a usable timezone is a loud data fault.
 */

import { describe, expect, it } from 'vitest';
import type { OutletDoc } from '../../models/menu.js';
import { assertOutletTimezone, outletDateKey } from './pickupToken.js';

function outlet(timezone?: string): OutletDoc {
  return {
    publicId: 'demo-outlet',
    name: 'Demo',
    currency: 'INR',
    active: true,
    ...(timezone === undefined ? {} : { timezone }),
  };
}

describe('outletDateKey', () => {
  it('uses the outlet-local day, not the UTC day', () => {
    // 18:35 UTC is already the next calendar day in Asia/Kolkata (+05:30).
    const at = Date.parse('2026-11-08T18:35:00Z');
    expect(outletDateKey('Asia/Kolkata', at)).toBe('2026-11-09');
    expect(outletDateKey('UTC', at)).toBe('2026-11-08');
  });

  it('does not roll the window over at UTC midnight for an IST outlet', () => {
    // 00:30 UTC is 06:00 IST on the same IST day: a kitchen mid-service must
    // not see its tokens reset here.
    const before = Date.parse('2026-11-08T23:30:00Z');
    const after = Date.parse('2026-11-09T00:30:00Z');
    expect(outletDateKey('Asia/Kolkata', before)).toBe('2026-11-09');
    expect(outletDateKey('Asia/Kolkata', after)).toBe('2026-11-09');
  });

  it('zero-pads to a sortable YYYY-MM-DD key', () => {
    expect(outletDateKey('Asia/Kolkata', Date.parse('2026-01-05T06:00:00Z'))).toBe(
      '2026-01-05',
    );
  });
});

describe('assertOutletTimezone', () => {
  it('returns a valid IANA zone', () => {
    expect(assertOutletTimezone(outlet('Asia/Kolkata'))).toBe('Asia/Kolkata');
  });

  it('refuses a missing timezone rather than assuming one', () => {
    expect(() => assertOutletTimezone(outlet())).toThrow(/no timezone/);
    expect(() => assertOutletTimezone(outlet('  '))).toThrow(/no timezone/);
  });

  it('refuses an invalid timezone', () => {
    expect(() => assertOutletTimezone(outlet('Mars/Olympus'))).toThrow(
      /invalid timezone/,
    );
  });

  it('accepts every seeded outlet', async () => {
    const { SAMPLE_MENU } = await import('../menu/inMemoryMenuRepository.js');
    for (const seeded of SAMPLE_MENU.outlets) {
      expect(() => assertOutletTimezone(seeded)).not.toThrow();
    }
  });
});
