# Design System

**Status:** Initial direction; validate with outlet staff and customers before branding is finalized.

## 1. Design direction

**Style:** Calm, clear, practical, high-contrast service interface. **Mood:** Welcoming and dependable in a busy food outlet. **Principles:** Make the next action obvious; keep price and order state visible; support voice and touch equally; prevent mistakes with review and undo; use plain language and familiar food imagery only when available and accurate.

This is a neutral starting system, not a final brand identity. Avoid stereotypes, excessive decorative Indian motifs, or unverified brand claims.

## 2. Brand and voice

Product name and logo are undecided. Use a text wordmark placeholder until chosen. UI copy is concise, respectful, and non-judgmental. Voice prompts should say what was understood, ask one clarification at a time, and never imply an order or payment is complete before the backend confirms it. Customers can request menu recommendations whenever they ask. An unsolicited recommendation may appear only once per session, never during review, confirmation, or payment, and must stop after a decline.

## 3. Color tokens

Initial tokens (verify contrast in implementation):

| Token | Value | Use |
|---|---|---|
| Primary | `#145A4A` | Main actions, selected navigation |
| Primary-strong | `#0D4337` | Hover/pressed states |
| Accent | `#F2B84B` | Secondary emphasis, never status alone |
| Background | `#F7F7F4` | Page background |
| Surface | `#FFFFFF` | Cards and dialogs |
| Text | `#202522` | Main text |
| Muted text | `#5C665F` | Supporting copy |
| Border | `#D7DDD8` | Dividers and input borders |
| Success | `#18794E` | Confirmed/ready status with text/icon |
| Warning | `#8A5700` | Pending attention with text/icon |
| Error | `#B42318` | Errors with text/icon |

Check WCAG contrast for actual text sizes and combinations. Do not communicate status by color alone.

## 4. Typography and spacing

Use a system sans-serif stack with robust Kannada glyph fallback; test actual target devices. Suggested CSS family: `system-ui, "Noto Sans Kannada", sans-serif` only when that font is available. Use 16px minimum body text, 14px minimum secondary text, 1.45+ body line height, and larger 18–20px kiosk body text. Scale headings by semantic hierarchy rather than decoration.

Spacing base: 4px; scale: 4, 8, 12, 16, 24, 32, 48, 64px. Small/medium/large radii: 6/10/16px; pill for chips only. Use subtle borders and restrained shadows; never rely on shadow alone to define controls.

## 5. Controls and states

- Primary button: solid primary, verb-first label, large hit area (minimum 44×44 CSS px; kiosk controls should be larger). Show disabled and in-progress states.
- Secondary: outlined or quiet surface button. Destructive action requires clear label and confirmation where it would lose submitted work.
- Inputs: persistent labels, visible focus ring, inline error text and association, usable numeric quantity controls, clear microphone permission/state.
- Cards: consistent padding (16–24px), border, and heading. Order items must keep quantity, options, and price scannable.
- Loading: explain what is happening and prevent duplicate submission while preserving idempotent retry.
- Empty: explain the empty state and a valid next action.
- Error/offline: say whether the action was saved; provide retry or touch/counter fallback.
- Success: show server-confirmed outcome and token/status where applicable.

## 6. Navigation and responsive behavior

Customer flow uses a simple outlet/menu header, category navigation, cart summary, and clear review/confirm step. Kiosk surfaces the language/voice choice and touch fallback without deep navigation. Merchant dashboard prioritizes new/preparing/ready queues and persistent connection status.

Design mobile-first. QR ordering must work at narrow phone widths and zoom. Kiosk is optimized for landscape or portrait only after target hardware is chosen. Dashboard adapts from compact tablet to desktop. Do not assume specific breakpoints; begin near 600px and 900px and adjust based on content.

## 7. Icons and accessibility

Use the icon library already present in the repository; if none exists, choose one consistent accessible library before adding a dependency. Pair icons with labels for microphone, payment, and status. Use semantic HTML, keyboard navigation, visible focus, screen-reader labels, reduced-motion preference, adequate contrast, scalable text, and language attributes per displayed content. Announce cart changes and order-status updates politely. Voice is never the only input or output path. Ensure Kannada text and mixed-script text do not clip or reorder incorrectly.
