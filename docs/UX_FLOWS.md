# UX Flows

These flows describe the MVP target. Provider-specific voice behavior and final UI details remain subject to validation. QR and kiosk use the same conversational layer and backend ordering rules. Shared lifecycle: customer order entry → editable review → explicit confirmation → payment choice/status → pickup token → kitchen preparation → ready/collection.

## Flow 1 - Start ordering (QR or kiosk)

1. Customer scans outlet QR or approaches kiosk.
2. App identifies the outlet and channel; creates/loads an isolated short-lived session.
3. Show outlet name, active menu, prices, language choice, and touch path.
4. Customer chooses Kannada, English, Hinglish, or a touch-first path.

**Loading:** Show menu loading. **Failure:** Explain connection issue and retry/counter fallback; never show a false empty menu. **Success:** Menu is tied to the resolved outlet.

## Flow 2 - Browse and build cart

1. Customer browses categories/items or taps microphone and grants permission.
2. For voice: show listening/processing state, send audio through the Gnani STT adapter, then pass normalized text and session context through the shared conversational service and Sarvam LLM adapter into a draft action.
3. Show recognized item/quantity/options in the cart; ask a single clarification for ambiguity or offer touch selection.
4. Customer edits/removes items against the server-side cart, which is the primary ordering interface: every add, quantity change, removal and clear is a server call that returns the whole repriced draft. Voice and touch amend the same draft, so a change made either way is immediately visible in the other.
5. Server validates active items/options and returns authoritative prices/total. The client displays only those amounts and never computes a total of its own.

**Empty:** Suggest categories and explain voice/touch choices. **Voice denied/fails:** Preserve cart and offer touch input/retry. No spoken action submits an order.

**Item unavailable (agreed display rule).** A line whose item or option has gone away or been switched off is still returned, marked unavailable, with zero `unitPriceMinor`/`lineTotalMinor` and an issue reason. Zero is **not** a free item. The client must:

- mark the line distinctly from an orderable one - not merely greyed out - and say why in plain language for the reason given (item sold out, item no longer on the menu, that customisation no longer available, cannot be priced);
- offer remove or replace on the line itself;
- exclude it from the displayed total, as the server already does;
- **block checkout** - no quote request and no path to confirmation - while any such line remains, and say that is why, rather than letting the customer reach a failed confirmation.

Announce an item becoming unavailable politely for screen-reader users, as with other cart changes ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)).

**Two surfaces editing one draft.** Each cart response carries an integer `revision`. A client sends it back on a mutation that must not apply to a draft it has not seen; if the draft moved in between, the server refuses the change and returns the current revision, and the client re-reads the draft, reapplies the customer's intent and shows the current state rather than overwriting the other surface's edit.

Customers may ask for recommendations at any point in the flow. Proactive recommendations are limited to one per session, are never offered during review, confirmation, or payment, and stop after a decline. All suggested items/options are revalidated against the current backend menu and quoted by the server.

## Flow 3 - Review, confirm, and choose payment

1. Customer opens final review with item details, options, quantities, and current total. Review is reachable only from a draft in which every line is orderable; an unavailable line blocks it until removed or replaced (flow 2).
2. Customer may edit; the edit goes to the same server-side draft and the server refreshes the quote if the menu or quote is stale. An edit that reveals a newly unavailable line sends the customer back to resolving it rather than to confirmation.
3. Customer selects UPI QR instructions or cash at counter.
4. Customer explicitly presses “Confirm order” after seeing the selection and total.
5. Client submits confirmation with idempotency key; server revalidates and creates one order/token.
6. UPI status stays pending until trusted callback or staff confirmation; cash stays due at counter until staff records receipt.
7. Show token and order status only after server confirms creation.

**Retry:** Reuse idempotency key for the same action. **Failure:** Tell customer whether order creation is confirmed; if unknown, query by scoped idempotency state before retry. Never imply payment from customer speech or QR display.

## Flow 4 - Merchant and kitchen queue

1. Staff authenticates using the selected staff-auth mechanism (undecided).
2. Dashboard fetches outlet-scoped orders and visibly indicates freshness/connectivity.
3. Staff opens an order, checks items and separate payment state, and accepts/prepares it.
4. Kitchen moves it to ready; customer-facing status shows token and ready state.
5. Staff marks collected; status history records actor and time.

Reject unauthorized or invalid transitions. On stale connection, show last refresh and retry; never imply a failed update succeeded. Payment status changes only via trusted callback or authorized staff action.

## Flow 5 - Merchant menu availability

1. Authorized staff opens menu management.
2. Staff marks item/options available or unavailable and saves.
3. API validates outlet permissions and persists change.
4. New quotes/orders reflect the change; previously confirmed orders retain their snapshot.

Price editing may be deferred if the MVP needs only seeded menu data. If enabled, changes are auditable and never rewrite existing orders.
