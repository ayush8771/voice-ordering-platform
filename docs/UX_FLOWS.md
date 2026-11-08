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
4. Customer edits/removes items; client requests server quote.
5. Server validates active items/options and returns authoritative prices/total.

**Empty:** Suggest categories and explain voice/touch choices. **Voice denied/fails:** Preserve cart and offer touch input/retry. **Item unavailable:** Explain and remove/replace before checkout. No spoken action submits an order.

Customers may ask for recommendations at any point in the flow. Proactive recommendations are limited to one per session, are never offered during review, confirmation, or payment, and stop after a decline. All suggested items/options are revalidated against the current backend menu and quoted by the server.

## Flow 3 - Review, confirm, and choose payment

1. Customer opens final review with item details, options, quantities, and current total.
2. Customer may edit; server refreshes quote if menu or quote is stale.
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
