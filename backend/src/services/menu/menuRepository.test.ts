/**
 * The listing-order contract every `MenuRepository` must satisfy.
 *
 * It is asserted here as a unit, and asserted again against a real `mongod` in
 * `mongoMenuRepository.integration.test.ts`. Both matter: this file pins the
 * intended rule, that file proves MongoDB actually produces it.
 */

import { describe, expect, it } from 'vitest';
import { compareCodePoints, compareListingOrder } from './menuRepository.js';

describe('compareCodePoints', () => {
  it('orders by Unicode code point, which is what MongoDB binary collation does', () => {
    // Uppercase sorts before lowercase: U+0049 < U+0069. `localeCompare` would
    // give the opposite, which is exactly the divergence this replaces.
    expect(compareCodePoints('Idli', 'idli')).toBeLessThan(0);
    expect('Idli'.localeCompare('idli')).toBeGreaterThan(0);
  });

  it('treats a prefix as smaller than the longer string', () => {
    expect(compareCodePoints('Idli', 'Idli Sambar')).toBeLessThan(0);
    expect(compareCodePoints('Idli Sambar', 'Idli')).toBeGreaterThan(0);
  });

  it('is zero only for an identical string', () => {
    expect(compareCodePoints('ದೋಸೆ', 'ದೋಸೆ')).toBe(0);
    expect(compareCodePoints('', '')).toBe(0);
    expect(compareCodePoints('', 'a')).toBeLessThan(0);
  });

  it('puts Latin before Devanagari before Kannada, by code block', () => {
    const names = ['ದೋಸೆ', 'चाय', 'Dosa'];

    expect([...names].sort(compareCodePoints)).toEqual(['Dosa', 'चाय', 'ದೋಸೆ']);
  });

  it('is a consistent total order over a mixed-script set', () => {
    const names = ['Idli', 'idli', 'चाय', 'Dosa', 'ದೋಸೆ', 'Tiffin', ''];

    const sorted = [...names].sort(compareCodePoints);
    // Antisymmetric and transitive enough for a stable sort: reversing the
    // input must not change the result.
    expect([...names].reverse().sort(compareCodePoints)).toEqual(sorted);
  });
});

describe('compareListingOrder', () => {
  const row = (sortOrder: number, name: string, publicId: string) => ({
    sortOrder,
    name,
    publicId,
  });

  it('puts the merchant sortOrder first', () => {
    const rows = [row(2, 'Aaa', 'a'), row(1, 'Zzz', 'z')];

    expect([...rows].sort(compareListingOrder).map((item) => item.publicId)).toEqual([
      'z',
      'a',
    ]);
  });

  it('breaks a sortOrder tie on name, then on publicId', () => {
    const rows = [
      row(1, 'Same', 'c'),
      row(1, 'Same', 'a'),
      row(1, 'Other', 'b'),
      row(1, 'Same', 'b'),
    ];

    expect([...rows].sort(compareListingOrder).map((item) => item.publicId)).toEqual([
      'b', // 'Other'
      'a',
      'b',
      'c',
    ]);
  });

  it('is total, so the order does not depend on input order', () => {
    const rows = [
      row(1, 'Idli', 'i1'),
      row(1, 'idli', 'i2'),
      row(1, 'चाय', 'c1'),
      row(2, 'Dosa', 'd1'),
      row(1, 'Idli', 'i0'),
    ];

    const sorted = [...rows].sort(compareListingOrder).map((item) => item.publicId);
    expect(
      [...rows]
        .reverse()
        .sort(compareListingOrder)
        .map((item) => item.publicId),
    ).toEqual(sorted);
    // sortOrder 1 first, within it by code point: 'Idli' (U+0049) < 'idli'
    // (U+0069) < 'चाय' (U+091A); 'Idli' ties break on publicId.
    expect(sorted).toEqual(['i0', 'i1', 'i2', 'c1', 'd1']);
  });
});
