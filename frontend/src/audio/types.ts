import type { Language } from '@vop/shared';

/**
 * Client-side speech interfaces. Declarations only: there is no implementation
 * in this milestone and nothing here makes a provider call or consumes credit.
 *
 * Division of responsibility (docs/ARCHITECTURE.md section 5,
 * docs/PROVIDERS.md):
 * - the browser owns microphone permission and capture, and nothing else;
 * - Gnani Prisma (STT) and Gnani Timbre (TTS) are reached only through backend
 *   routes, because a provider credential must never exist in a client bundle;
 * - the conversational turn itself already goes through
 *   `POST /api/v1/conversation/turns` - a transcript is just text for that
 *   call, and text never confirms an order (docs/SECURITY.md section 2).
 *
 * The backend speech routes do not exist yet and the Gnani request/response
 * schemas are unverified, so these interfaces deliberately describe only what
 * the UI needs (audio in, text out; text in, audio out) and invent no provider
 * field, model name, encoding or error shape. An implementation is written
 * once those APIs are verified; until then every caller treats the absence of
 * one as "voice unavailable" and keeps the touch path (docs/PRD.md section 5).
 */

/** Microphone capture. Permission is requested by `start`, never ahead of it. */
export interface AudioCapture {
  /** Rejects when the customer denies the microphone or no device exists. */
  start(): Promise<void>;
  /** Stops capture and resolves with the recorded audio. */
  stop(): Promise<Blob>;
  cancel(): void;
}

/** Transcription, performed by the backend STT adapter. */
export interface SpeechToTextClient {
  transcribe(input: {
    readonly audio: Blob;
    readonly language: Language;
  }): Promise<{ readonly text: string }>;
}

/** Spoken assistant replies, synthesized by the backend TTS adapter. */
export interface TextToSpeechClient {
  speak(input: { readonly text: string; readonly language: Language }): Promise<void>;
  stop(): void;
}

/**
 * What the UI is handed. Every field is optional: `undefined` means that
 * capability is unavailable and the surface must stay fully usable by touch.
 */
export interface SpeechClients {
  readonly capture?: AudioCapture;
  readonly stt?: SpeechToTextClient;
  readonly tts?: TextToSpeechClient;
}
