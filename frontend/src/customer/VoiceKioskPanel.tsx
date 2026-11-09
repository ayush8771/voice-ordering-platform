import { useEffect, useRef, useState, type JSX } from 'react';
import type { Language } from '@vop/shared';
import type { SpeechClients } from '../audio/types';
import { voiceAvailability, voicePhaseCopy, type VoicePhase } from './voiceState';

/**
 * Kiosk voice panel: a large microphone control with visible states, plus a
 * typed fallback. It only drives the interfaces in `audio/types.ts`; with no
 * client supplied (the state this build ships in) it says voice is not
 * connected and never pretends to listen.
 *
 * A transcript is ordinary text for `onSend`, exactly like typed input: it can
 * change the draft only, and never confirms an order (docs/SECURITY.md
 * section 2). The menu below stays the complete ordering path.
 */
export function VoiceKioskPanel({
  speech,
  language,
  assistantUnavailable,
  lastAssistantText,
  busy,
  onSend,
}: {
  speech: SpeechClients | undefined;
  language: Language;
  assistantUnavailable: boolean;
  lastAssistantText: string | undefined;
  busy: boolean;
  onSend: (text: string) => Promise<void>;
}): JSX.Element {
  const availability = voiceAvailability(speech, assistantUnavailable);
  const [active, setActive] = useState<'ready' | 'listening' | 'processing' | 'error'>(
    'ready',
  );
  const [responding, setResponding] = useState(false);
  const [text, setText] = useState('');
  const awaitingReply = useRef(false);
  /** The reply on screen when the turn started; a failed turn leaves it unchanged. */
  const replyBeforeTurn = useRef<string | undefined>(undefined);

  const capture = speech?.capture;
  const stt = speech?.stt;
  const tts = speech?.tts;

  // When a turn we started finishes, speak the reply if TTS exists.
  useEffect(() => {
    if (!awaitingReply.current || busy) return;
    awaitingReply.current = false;
    if (tts === undefined || lastAssistantText === undefined) return;
    // Never re-speak the previous reply when this turn produced none.
    if (lastAssistantText === replyBeforeTurn.current) return;
    setResponding(true);
    tts
      .speak({ text: lastAssistantText, language })
      .catch(() => undefined)
      .finally(() => setResponding(false));
  }, [busy, lastAssistantText, tts, language]);

  // Never leave the microphone or audio running when the panel goes away.
  useEffect(
    () => () => {
      capture?.cancel();
      tts?.stop();
    },
    [capture, tts],
  );

  const phase: VoicePhase =
    availability.kind === 'assistantDown'
      ? 'unavailable'
      : active === 'listening'
        ? 'listening'
        : active === 'processing' || busy
          ? 'processing'
          : responding
            ? 'responding'
            : active === 'error'
              ? 'error'
              : availability.kind === 'notConnected'
                ? 'unavailable'
                : 'ready';
  const copy = voicePhaseCopy(phase, availability);
  const voiceReady = availability.kind === 'available';

  const send = async (value: string): Promise<void> => {
    awaitingReply.current = true;
    replyBeforeTurn.current = lastAssistantText;
    await onSend(value);
  };

  const onMic = async (): Promise<void> => {
    if (capture === undefined || stt === undefined) return;
    if (active === 'listening') {
      setActive('processing');
      try {
        const audio = await capture.stop();
        const { text: transcript } = await stt.transcribe({ audio, language });
        if (transcript.trim() === '') {
          setActive('error');
          return;
        }
        setActive('ready');
        await send(transcript.trim());
      } catch {
        setActive('error');
      }
      return;
    }
    tts?.stop();
    setResponding(false);
    try {
      await capture.start();
      setActive('listening');
    } catch {
      setActive('error');
    }
  };

  const micLabel =
    phase === 'listening'
      ? 'Stop listening'
      : voiceReady
        ? 'Start voice ordering'
        : 'Voice ordering unavailable';

  return (
    <section
      className={`vop-card vop-voice vop-voice--${phase}`}
      aria-labelledby="vop-voice-title"
    >
      <h2 id="vop-voice-title" className="vop-visually-hidden">
        Voice and typed ordering
      </h2>

      <div className="vop-voice__main">
        <button
          type="button"
          className="vop-voice__mic"
          aria-label={micLabel}
          aria-pressed={voiceReady ? phase === 'listening' : undefined}
          disabled={!voiceReady || phase === 'processing'}
          onClick={() => void onMic()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2Z"
              fill="currentColor"
            />
            {!voiceReady && (
              <path d="M4 3 21 20" stroke="currentColor" strokeWidth="2" />
            )}
          </svg>
        </button>

        <div className="vop-voice__status" role="status" aria-live="polite">
          <p className="vop-voice__pill">
            <span className="vop-voice__dot" aria-hidden="true" />
            {copy.title}
          </p>
          <p className="vop-voice__detail vop-muted">{copy.detail}</p>
        </div>

        {phase === 'listening' && (
          <button
            type="button"
            className="vop-button"
            onClick={() => {
              capture?.cancel();
              setActive('ready');
            }}
          >
            Cancel
          </button>
        )}
        {phase === 'error' && (
          <button
            type="button"
            className="vop-button"
            onClick={() => setActive('ready')}
          >
            Dismiss
          </button>
        )}
      </div>

      {lastAssistantText !== undefined && (
        <p className="vop-voice__reply">
          <span className="vop-muted">Assistant: </span>
          {lastAssistantText}
        </p>
      )}

      {availability.kind !== 'assistantDown' && (
        <form
          className="vop-voice__type"
          onSubmit={(event) => {
            event.preventDefault();
            const value = text.trim();
            if (value === '') return;
            setText('');
            void send(value);
          }}
        >
          <label htmlFor="vop-voice-text">Or type what you would like</label>
          <div className="vop-search__row">
            <input
              id="vop-voice-text"
              className="vop-input"
              autoComplete="off"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <button
              type="submit"
              className="vop-button vop-button--primary"
              disabled={busy || phase === 'listening'}
            >
              Send
            </button>
          </div>
        </form>
      )}

      <p className="vop-voice__note vop-muted">
        Nothing is ordered until you review and confirm it on screen.
      </p>
    </section>
  );
}
