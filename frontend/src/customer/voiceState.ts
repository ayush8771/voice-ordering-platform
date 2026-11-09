import type { SpeechClients } from '../audio/types';

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
): VoicePhaseCopy {
  switch (phase) {
    case 'ready':
      return {
        title: 'Ready to listen',
        detail: 'Tap the microphone and say what you would like.',
      };
    case 'listening':
      return {
        title: 'Listening…',
        detail: 'Speak now. Tap again when you have finished.',
      };
    case 'processing':
      return { title: 'Working on it…', detail: 'Updating your draft order.' };
    case 'responding':
      return { title: 'Responding', detail: 'Here is what the assistant said.' };
    case 'error':
      return {
        title: 'Voice did not work',
        detail: 'Nothing was added. Try again, type below, or use the menu.',
      };
    case 'unavailable':
      return availability.kind === 'assistantDown'
        ? {
            title: 'Assistant unavailable',
            detail:
              'The assistant cannot help right now. Order with the menu below — it works the same way.',
          }
        : {
            title: 'Voice ordering is not available yet',
            detail:
              'Voice will be switched on once the speech service is connected. You can type a request, or order with the menu below.',
          };
  }
}
