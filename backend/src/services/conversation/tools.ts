/**
 * Tool allowlist and argument validation.
 *
 * docs/API.md: "Only server-defined tools may be offered to the model... The
 * backend validates tool name, schema, session/outlet scope, current menu
 * version, item availability, and quantities before execution. Never expose
 * order creation, quote acceptance, payment verification, or state-transition
 * tools."
 *
 * Two of the three tools are read-only menu lookups and are executed by the
 * service. `propose_draft_update` is NOT executed: it produces a proposal that
 * the customer must review, so it can never move the order forward on its own.
 */

/** The complete set of tool names the model may use. */
export const CONVERSATION_TOOLS = [
  'menu_search',
  'menu_item_details',
  'propose_draft_update',
] as const;
export type ConversationToolName = (typeof CONVERSATION_TOOLS)[number];

/**
 * Names that must never become tools. Listed explicitly so an attempt is
 * recorded as a `forbidden_tool` violation instead of an anonymous unknown
 * name, which makes prompt-injection attempts visible in logs.
 */
export const FORBIDDEN_TOOL_NAMES: readonly string[] = [
  'create_order',
  'confirm_order',
  'accept_quote',
  'place_order',
  'verify_payment',
  'update_payment_status',
  'mark_paid',
  'update_order_status',
  'set_price',
  'apply_discount',
  'set_availability',
  'update_menu',
];

/** Bounds applied to every proposal, independent of what the model asked for. */
export const MAX_SEARCH_RESULTS = 5;
export const MAX_QUANTITY = 20;
export const MAX_QUERY_CHARS = 80;
export const MAX_REF_CHARS = 120;
export const MAX_OPTION_REFS = 10;

export interface MenuSearchArgs {
  readonly name: 'menu_search';
  readonly query: string;
  readonly limit: number;
}

export interface MenuItemDetailsArgs {
  readonly name: 'menu_item_details';
  readonly menuItemId: string;
}

export interface ProposeDraftUpdateArgs {
  readonly name: 'propose_draft_update';
  readonly type: 'addItem' | 'updateQuantity' | 'removeItem' | 'clearDraft';
  /** Model-supplied item text or ID. Resolved against menu data, never trusted. */
  readonly menuItemRef?: string;
  readonly quantity?: number;
  readonly optionRefs?: readonly string[];
}

export type ValidatedToolCall =
  MenuSearchArgs | MenuItemDetailsArgs | ProposeDraftUpdateArgs;

export type ToolValidation =
  | { readonly ok: true; readonly call: ValidatedToolCall }
  | {
      readonly ok: false;
      readonly kind: 'forbidden_tool' | 'unknown_tool' | 'invalid_tool_arguments';
      readonly reason: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > maxChars) return undefined;
  return trimmed;
}

function readQuantity(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < 1 || value > MAX_QUANTITY) return undefined;
  return value;
}

function readOptionRefs(value: unknown): readonly string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_OPTION_REFS) return undefined;

  const refs: string[] = [];
  for (const entry of value) {
    const ref = readString(entry, MAX_REF_CHARS);
    if (ref === undefined) return undefined;
    refs.push(ref);
  }
  return refs;
}

/**
 * Validates one model-proposed tool call.
 *
 * Unknown and forbidden names are rejected before any argument parsing, so a
 * well-formed payload cannot talk its way into a tool that does not exist.
 */
export function validateToolCall(raw: unknown): ToolValidation {
  if (!isRecord(raw)) {
    return {
      ok: false,
      kind: 'invalid_tool_arguments',
      reason: 'tool call was not an object',
    };
  }

  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';

  if (FORBIDDEN_TOOL_NAMES.includes(name)) {
    return { ok: false, kind: 'forbidden_tool', reason: name };
  }
  if (!(CONVERSATION_TOOLS as readonly string[]).includes(name)) {
    return {
      ok: false,
      kind: 'unknown_tool',
      reason: name === '' ? '(missing)' : name,
    };
  }

  const args = isRecord(raw['arguments']) ? raw['arguments'] : raw;

  if (name === 'menu_search') {
    const query = readString(args['query'], MAX_QUERY_CHARS);
    if (query === undefined) {
      return { ok: false, kind: 'invalid_tool_arguments', reason: 'menu_search.query' };
    }
    const requested = args['limit'];
    const limit =
      typeof requested === 'number' && Number.isInteger(requested) && requested >= 1
        ? Math.min(requested, MAX_SEARCH_RESULTS)
        : MAX_SEARCH_RESULTS;
    return { ok: true, call: { name: 'menu_search', query, limit } };
  }

  if (name === 'menu_item_details') {
    const menuItemId = readString(args['menuItemId'], MAX_REF_CHARS);
    if (menuItemId === undefined) {
      return {
        ok: false,
        kind: 'invalid_tool_arguments',
        reason: 'menu_item_details.menuItemId',
      };
    }
    return { ok: true, call: { name: 'menu_item_details', menuItemId } };
  }

  // propose_draft_update
  const type = args['type'];
  if (
    type !== 'addItem' &&
    type !== 'updateQuantity' &&
    type !== 'removeItem' &&
    type !== 'clearDraft'
  ) {
    return {
      ok: false,
      kind: 'invalid_tool_arguments',
      reason: 'propose_draft_update.type',
    };
  }

  const optionRefs = readOptionRefs(args['optionRefs']);
  if (optionRefs === undefined) {
    return {
      ok: false,
      kind: 'invalid_tool_arguments',
      reason: 'propose_draft_update.optionRefs',
    };
  }

  if (type === 'clearDraft') {
    return { ok: true, call: { name: 'propose_draft_update', type } };
  }

  const menuItemRef = readString(args['menuItemRef'], MAX_REF_CHARS);
  if (menuItemRef === undefined) {
    return {
      ok: false,
      kind: 'invalid_tool_arguments',
      reason: 'propose_draft_update.menuItemRef',
    };
  }

  // A quantity is required where it changes what the customer would receive.
  const quantity = readQuantity(args['quantity']);
  if (type !== 'removeItem' && quantity === undefined) {
    return {
      ok: false,
      kind: 'invalid_tool_arguments',
      reason: 'propose_draft_update.quantity',
    };
  }

  return {
    ok: true,
    call: {
      name: 'propose_draft_update',
      type,
      menuItemRef,
      ...(quantity === undefined ? {} : { quantity }),
      ...(optionRefs.length === 0 ? {} : { optionRefs }),
    },
  };
}

/** Tool descriptions injected into the prompt. Kept in one place with the allowlist. */
export const TOOL_SPECIFICATIONS: readonly string[] = [
  'menu_search { "query": string, "limit"?: integer } - find items in the current outlet menu.',
  'menu_item_details { "menuItemId": string } - read one item returned by menu_search.',
  'propose_draft_update { "type": "addItem"|"updateQuantity"|"removeItem"|"clearDraft", "menuItemRef"?: string, "quantity"?: integer, "optionRefs"?: string[] } - propose a draft-cart change for the customer to review.',
];
