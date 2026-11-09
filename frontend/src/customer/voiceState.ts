import type { Language } from '@vop/shared';
import type { SpeechClients } from '../audio/types';
import { translate } from '../i18n/translate';

/**
 * Display states for the kiosk voice panel. Pure helpers so the wording and
 * the availability rule are testable without a browser.
 *
 * Voice is "available" only when a real capture client and a real STT client
 * were supplied. Nothing here fakes a provider: with no client the panel says
 * voice is unavailable and the touch path carries the order
 * (docs/PRD.md section 5, docs/PROVIDERS.md).
 */
export type VoicePhase =
  'ready' | 'listening' | 'processing' | 'responding' | 'unavailable' | 'error';

export type VoiceAvailability =
  | { readonly kind: 'available' }
  | { readonly kind: 'notConnected' }
  | { readonly kind: 'assistantDown' };

export function voiceAvailability(
  speech: SpeechClients | undefined,
  assistantUnavailable: boolean,
): VoiceAvailability {
  if (assistantUnavailable) return { kind: 'assistantDown' };
  if (speech?.capture === undefined || speech.stt === undefined) {
    return { kind: 'notConnected' };
  }
  return { kind: 'available' };
}

export interface VoicePhaseCopy {
  readonly title: string;
  readonly detail: string;
}

export function voicePhaseCopy(
  phase: VoicePhase,
  availability: VoiceAvailability,
  language: Language = 'en',
): VoicePhaseCopy {
  const copy = (
    state:
      | 'ready'
      | 'listening'
      | 'processing'
      | 'responding'
      | 'error'
      | 'assistantDown'
      | 'notConnected',
  ): VoicePhaseCopy => ({
    title: translate(language, `voice.${state}.title`),
    detail: translate(language, `voice.${state}.detail`),
  });
  if (phase !== 'unavailable') return copy(phase);
  return copy(availability.kind === 'assistantDown' ? 'assistantDown' : 'notConnected');
}
