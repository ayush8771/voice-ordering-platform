import { describe, expect, it } from 'vitest';
import type { SpeechClients } from '../audio/types';
import { voiceAvailability, voicePhaseCopy } from './voiceState';

const clients: SpeechClients = {
  capture: {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(new Blob()),
    cancel: () => undefined,
  },
  stt: { transcribe: () => Promise.resolve({ text: 'one dosa' }) },
};

describe('voiceAvailability', () => {
  it('is not connected when no speech client is supplied', () => {
    expect(voiceAvailability(undefined, false).kind).toBe('notConnected');
    const { capture: _omit, ...sttOnly } = clients;
    expect(voiceAvailability(sttOnly, false).kind).toBe('notConnected');
  });

  it('is available only with both capture and STT', () => {
    expect(voiceAvailability(clients, false).kind).toBe('available');
  });

  it('reports the assistant as down even when clients exist', () => {
    expect(voiceAvailability(clients, true).kind).toBe('assistantDown');
  });
});

describe('voicePhaseCopy', () => {
  it('says plainly that voice is not connected, and points to the menu', () => {
    const copy = voicePhaseCopy('unavailable', { kind: 'notConnected' });
    expect(copy.title).toMatch(/not available/i);
    expect(copy.detail).toMatch(/menu/i);
  });

  it('distinguishes an assistant outage from a missing integration', () => {
    expect(voicePhaseCopy('unavailable', { kind: 'assistantDown' }).title).toMatch(
      /assistant unavailable/i,
    );
  });

  it('has distinct titles for every active state', () => {
    const available = { kind: 'available' } as const;
    const titles = (
      ['ready', 'listening', 'processing', 'responding', 'error'] as const
    ).map((phase) => voicePhaseCopy(phase, available).title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
