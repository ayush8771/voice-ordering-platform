# Product Requirements Document

**Status:** Working MVP specification  
**Product:** Multilingual AI self-ordering and queue-management for independent Indian food outlets

## 1. Product overview

Help busy independent food outlets accept takeaway orders without requiring a cashier to take every order. Customers can order by speaking at a kiosk or using a QR mobile web experience, review the structured order, explicitly confirm it, choose UPI QR or cash at counter, and receive a pickup token. A shared backend routes the same validated order to the merchant/kitchen dashboard.

**Primary platform:** Responsive web customer experience, kiosk-mode web experience, merchant/kitchen web dashboard, Node.js backend.  
**Languages:** Kannada, English, Hinglish (mixed Hindi-English). Interface translation and recognition quality must be validated; language support is not a promise of perfect transcription.

## 2. Problem and goal

At busy independent stalls and small QSRs, a single order desk can become a bottleneck. Customers may abandon a long queue, staff can miss or mishear orders, and kitchens need a clear queue. Current workarounds include verbal ordering at the counter and separate QR menu/order tools.

**Primary goal:** Demonstrate a complete, reliable order lifecycle from customer order entry through merchant preparation and pickup-token display, across kiosk and QR channels.

**Secondary goals:** Reduce time spent taking routine orders; let customers correct the AI before submission; give staff an actionable live queue; support manual fallback when voice or network services fail.

## 3. Target users

### Walk-up customer
Needs a quick, understandable way to order in a familiar language, review prices and choices, and know when to collect. May have limited time, noisy surroundings, or limited comfort with apps.

### Outlet staff / merchant
Needs to maintain an accurate menu, see newly submitted orders, distinguish payment states, and update preparation/ready status with minimal training.

### Kitchen staff
Needs an unambiguous, ordered ticket with item quantities and customer choices, plus a clear ready/claimed lifecycle.

**Initial target assumption:** One high-footfall independent takeaway outlet for the MVP demonstration. “All” customer types is an aspiration, not a validated launch segment.

## 4. User stories

- As a customer, I can browse a current menu and prices so I can choose confidently.
- As a customer, I can speak Kannada, English, or Hinglish or use touch controls so I can place an order in a convenient way.
- As a customer, I can inspect and edit the interpreted cart before confirming so recognition errors do not become orders.
- As a customer, I can choose UPI QR or cash at counter and see the payment status accurately.
- As a customer, I receive a pickup token after the order is accepted and can see its progress.
- As staff, I can receive and advance orders through preparation and ready states.
- As a merchant, I can edit menu availability and prices, with changes reflected in new orders.

## 5. MVP features and acceptance criteria

### Menu and customer ordering
**Inputs:** Active outlet menu, item selection, quantity, supported customisations, optional voice transcript/utterance. **Output:** Editable cart and server-calculated quote.

- Given an active menu, both kiosk and QR clients show the same available items, options, and prices.
- Client-submitted prices are ignored; the server calculates line totals and total from the current menu.
- Unknown, unavailable, ambiguous, or unsupported requests produce a clarification or manual selection path; they never silently add a guessed item.
- The cart shows item, quantity, customisations, subtotal/total, and any service/tax charges only if those rules have been explicitly configured.
- Voice is optional; core browsing and ordering remain usable by touch and keyboard.

### Voice interaction
**Inputs:** Customer microphone permission, selected/supported language, utterance. **Output:** Transcript or understood intent, spoken/displayed response, updated draft cart.

- Customer starts recording explicitly and can stop/cancel; the interface indicates listening, processing, and failure states.
- Speech recognition and synthesis are behind provider adapters for Gnani Prisma STT and Gnani Timbre TTS. Exact request/response fields, language codes, limits, streaming support, and availability are **unverified** and must be confirmed against provider documentation before integration.
- Transcript-derived actions update only the active draft session and are shown for review.
- No order is submitted or payment treated as complete based solely on speech.
- On denied microphone permission, timeout, provider failure, or low-confidence/ambiguous recognition, offer retry and touch entry without losing the draft.

### Confirmation, payment choice, and token

- Before submission, customer sees the final server-calculated order and presses/taps a clearly labelled confirmation control.
- The order is created idempotently for a confirmed draft and receives one unique, outlet-scoped pickup token.
- For UPI QR, show the configured payment instructions/QR and keep order payment `pending` until a trusted payment verification callback or staff confirmation changes it. A displayed QR or customer claim of payment is not proof.
- For cash at counter, mark payment `due_at_counter`; staff may record collection through an authorized dashboard action.
- A customer sees token and status after successful creation. Token generation failure or duplicate submission must not create duplicate kitchen tickets.

### Merchant/kitchen dashboard

- Authorized staff see new orders ordered by creation time and can open the complete item details.
- Staff can move orders through `accepted`, `preparing`, `ready`, and `collected`, with invalid transitions rejected server-side.
- Payment state is visible separately from preparation state.
- Staff can mark a menu item unavailable; subsequent quotes and orders reject it while existing orders retain their confirmed item/price snapshot.
- Dashboard loading, empty, stale-connection, and error states are visible; a failed refresh does not silently imply there are no orders.

## 6. Non-goals

- Production payment collection, settlement, refunds, or a specific payment-provider integration.
- POS integration, printer integration, multi-outlet administration, delivery, table service, loyalty, customer accounts, or customer profiles.
- Automated customer identity verification or a selected authentication vendor.
- Claims of production-grade speech accuracy, noisy-room performance, or support for languages beyond the stated initial set.
- Unattended AI changes to prices, menu availability, payment status, or order lifecycle.

## 7. MVP scope and milestones

**Must have:** Menu and availability; responsive QR and kiosk ordering; touch fallback; voice adapter boundary; draft/cart and explicit confirmation; server-side price validation; UPI QR instructions or cash-at-counter selection with honest pending/due states; idempotent order creation and pickup token; merchant order queue and status updates; security and critical-flow tests.

**Nice to have:** TTS responses; language preference remembered for the active session; simple queue count/estimated wait if a defensible estimate can be computed.

**Future:** Production payment provider, POS, multi-outlet support, analytics, account-based history, notifications, additional languages and advanced speech tuning.

1. **Foundation:** inspect repository, agree shared contracts, set up app/backend structure and local configuration.
2. **Menu and touch ordering:** implement menu, cart, server quote, and validation.
3. **Order lifecycle:** confirmation, payment-choice states, idempotency, token, merchant queue.
4. **Voice and kiosk:** integrate verified provider contracts behind adapters; add failure and touch fallback.
5. **Hardening/demo:** test two independent sessions, payment-state integrity, accessibility, and end-to-end lifecycle.

Milestones are dependency order, not fixed dates. Ayush owns backend, AI integration, and order processing. Anvesh owns customer and merchant interfaces. Both review shared API/schema changes before implementation.

## 8. Success measures

For the demo, record: successful order completion rate across both channels; duplicate order count (target zero); incorrect price/item acceptance (target zero in deterministic tests); order-to-dashboard latency; staff ability to advance the order; voice fallback success; and task completion using touch/keyboard. Establish numeric usability/performance targets after a pilot; do not claim queue reduction without measurement.

## 9. Constraints, assumptions, open questions

**Confirmed:** React, Node.js, MongoDB; shared backend for kiosk and QR; Kannada/English/Hinglish intent; Gnani Prisma STT and Timbre TTS are intended providers; UPI QR or cash at counter; pickup tokens; merchant/kitchen dashboard; Ayush backend/AI/orders; Anvesh customer/merchant frontend.

**Assumptions:** MVP is a web-based demo for one outlet; one currency (INR); outlet staff can confirm cash and UPI receipt manually; QR opens a public outlet-scoped session. Validate before treating these as final.

**Open:** Exact UI framework/tooling and repository structure; whether Hinglish means Hindi-English code-switching only; Gnani API credentials/contracts, supported language identifiers, retention terms, and audio handling; payment QR source and how trusted callbacks would be authenticated; staff authentication and roles; hosting, TLS, domain, deployment and backups; tax/charge rules; token reset/uniqueness window; menu customisation model; target hardware/network; privacy notice, audio retention and consent; outlet pilot and measurable targets.

## 10. Definition of done

- Acceptance criteria for the scoped feature are verified.
- No order can be created without explicit confirmation and server validation.
- Spoken “paid” cannot alter payment status; trusted callback or authorized staff confirmation is required.
- Idempotency, session isolation, unavailable items, and provider/network failure cases are covered.
- Relevant automated checks are run and their actual results reported; unrun checks are identified.
- Documentation reflects implemented behavior and unresolved decisions remain visible.
