/**
 * Parsing of model replies.
 *
 * Model output is untrusted input (docs/SECURITY.md section 2), so this module
 * assumes nothing: a reply may be valid JSON, JSON inside a code fence, or
 * ordinary prose. Anything unparseable degrades to "text only, no actions",
 * which is safe because actions are what could change the draft.
 *
 * Every array and string is bounded here, before the rest of the service sees
 * it, so a long or repetitive reply cannot be amplified downstream.
 */

export const MAX_REPLY_CHARS = 1200;
export const MAX_TOOL_CALLS = 3;
export const MAX_SUGGESTIONS = 3;

export interface RawSuggestion {
  readonly menuItemRef: string;
  readonly kind: 'requested' | 'proactive';
}

export interface ParsedModelOutput {
  readonly reply: string;
  readonly toolCalls: readonly unknown[];
  readonly suggestions: readonly RawSuggestion[];
  readonly needsClarification: boolean;
  /** True when the reply was not the requested JSON object. */
  readonly unstructured: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

/** Strips a ```json fence and finds the outermost JSON object, if any. */
function extractJsonObject(text: string): string | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  return candidate.slice(start, end + 1);
}

function readSuggestions(raw: unknown): readonly RawSuggestion[] {
  if (!Array.isArray(raw)) return [];

  const suggestions: RawSuggestion[] = [];
  for (const entry of raw.slice(0, MAX_SUGGESTIONS)) {
    if (!isRecord(entry)) continue;
    const ref = entry['menuItemRef'];
    if (typeof ref !== 'string' || ref.trim() === '') continue;
    // An unrecognized kind is treated as proactive: that is the restricted
    // case, so a malformed value cannot bypass the one-per-session limit.
    const kind = entry['kind'] === 'requested' ? 'requested' : 'proactive';
    suggestions.push({ menuItemRef: clamp(ref, 120), kind });
  }
  return suggestions;
}

/**
 * Parses an assistant message.
 *
 * `text` is the raw provider text. The result is always usable: on failure the
 * whole reply becomes `reply` with no tool calls and no suggestions.
 */
export function parseModelOutput(text: string): ParsedModelOutput {
  const fallback: ParsedModelOutput = {
    reply: clamp(text, MAX_REPLY_CHARS),
    toolCalls: [],
    suggestions: [],
    needsClarification: false,
    unstructured: true,
  };

  const json = extractJsonObject(text);
  if (json === undefined) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fallback;
  }
  if (!isRecord(parsed)) return fallback;

  const reply = parsed['reply'];
  const toolCalls = parsed['toolCalls'];

  return {
    reply: typeof reply === 'string' ? clamp(reply, MAX_REPLY_CHARS) : '',
    toolCalls: Array.isArray(toolCalls) ? toolCalls.slice(0, MAX_TOOL_CALLS) : [],
    suggestions: readSuggestions(parsed['suggestions']),
    needsClarification: parsed['needsClarification'] === true,
    unstructured: false,
  };
}
