import { describe, expect, it } from 'vitest';
import { MAX_REPLY_CHARS, MAX_SUGGESTIONS, parseModelOutput } from './modelOutput.js';

describe('parseModelOutput', () => {
  it('parses the requested JSON envelope', () => {
    const parsed = parseModelOutput(
      JSON.stringify({
        reply: 'Added one dosa.',
        toolCalls: [{ name: 'menu_search', arguments: { query: 'dosa' } }],
        suggestions: [{ menuItemRef: 'Filter Coffee', kind: 'proactive' }],
        needsClarification: false,
      }),
    );

    expect(parsed.unstructured).toBe(false);
    expect(parsed.reply).toBe('Added one dosa.');
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.suggestions).toEqual([
      { menuItemRef: 'Filter Coffee', kind: 'proactive' },
    ]);
  });

  it('parses a fenced JSON block', () => {
    const parsed = parseModelOutput('```json\n{"reply":"Sure"}\n```');

    expect(parsed.unstructured).toBe(false);
    expect(parsed.reply).toBe('Sure');
  });

  it('treats prose as a reply with no actions', () => {
    const parsed = parseModelOutput('Sorry, we are out of vada today.');

    expect(parsed.unstructured).toBe(true);
    expect(parsed.reply).toBe('Sorry, we are out of vada today.');
    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.suggestions).toEqual([]);
  });

  it('treats malformed JSON as prose rather than failing', () => {
    const parsed = parseModelOutput('{"reply": "oops",');
    expect(parsed.unstructured).toBe(true);
    expect(parsed.toolCalls).toEqual([]);
  });

  it('defaults an unrecognized suggestion kind to the restricted case', () => {
    const parsed = parseModelOutput(
      JSON.stringify({
        reply: 'x',
        suggestions: [{ menuItemRef: 'Idli', kind: 'free' }],
      }),
    );

    expect(parsed.suggestions[0]?.kind).toBe('proactive');
  });

  it('bounds reply length, tool calls and suggestions', () => {
    const parsed = parseModelOutput(
      JSON.stringify({
        reply: 'x'.repeat(5000),
        toolCalls: Array.from({ length: 10 }, () => ({ name: 'menu_search' })),
        suggestions: Array.from({ length: 10 }, (_, i) => ({ menuItemRef: `i${i}` })),
      }),
    );

    expect(parsed.reply.length).toBe(MAX_REPLY_CHARS);
    expect(parsed.toolCalls.length).toBeLessThanOrEqual(3);
    expect(parsed.suggestions.length).toBe(MAX_SUGGESTIONS);
  });

  it('ignores a non-string reply', () => {
    const parsed = parseModelOutput(JSON.stringify({ reply: { text: 'hi' } }));
    expect(parsed.reply).toBe('');
  });
});
