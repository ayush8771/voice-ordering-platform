# Frontend

React 19 + TypeScript + Vite client for the customer (QR and kiosk), merchant and
kitchen surfaces. It talks only to the backend API under `/api/v1`; it never calls
an LLM, speech or payment provider directly, and it holds no secrets.

## Install and run

Requires Node >= 20.19. From the repository root:

```sh
npm install                          # all workspaces
npm run dev                          # backend (port 4000) + frontend (port 5173)
npm run dev --workspace frontend     # frontend only
```

For real menu and ordering data, run the backend with MongoDB and seed the demo
outlet first (see the root [README](../README.md)):

```sh
npm run seed --workspace backend
```

Then open <http://localhost:5173/?outlet=demo-outlet>.

## Routes

Routing is hash-based (`#/...`), so every route is served by `index.html` and
direct navigation or reload needs no server rewrite rules.

| URL | Surface |
|---|---|
| `/?outlet=<id>` | Customer QR ordering (mobile-first) |
| `/#/kiosk?outlet=<id>` | Customer kiosk ordering (larger touch targets, voice panel) |
| `/#/merchant?outlet=<id>` | Merchant overview (sample orders) |
| `/#/merchant/orders?outlet=<id>` | Merchant order list (sample orders) |
| `/#/merchant/menu?outlet=<id>` | Merchant menu, read-only (live public menu) |
| `/#/kitchen?outlet=<id>` | Kitchen display (sample orders) |
| `/#/payment-preview` | Payment-state design reference; **development builds only** |

The outlet ID is public. An ordering session ID never appears in a URL.

## Environment variables

The frontend reads no `VITE_*` variables at build or run time.

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `VITE_API_PROXY_TARGET` | Vite **dev server** only (`vite.config.ts`) | `http://localhost:4000` | Where `/api` is proxied during `npm run dev` |

Backend variables (`CORS_ALLOWED_ORIGINS`, MongoDB, providers) live in
`backend/.env`; see `.env.example`.

## Build and checks

```sh
npm run build --workspace frontend       # tsc --noEmit + vite build -> frontend/dist
npm run typecheck --workspace frontend
npm run test --workspace frontend        # Vitest, pure display/rule modules
npx eslint frontend/src
npx prettier --check frontend/src
```

`frontend/dist` is a static bundle (`index.html` + hashed `/assets/*`).

### Deploying the bundle

- **Same origin as the API.** The client calls the relative path `/api/v1`, and
  there is no API base-URL variable. The host must serve `dist/` and forward
  `/api` to the backend on the same origin (or the backend must serve `dist/`).
  The dev proxy does not exist in a production build.
- **Root path.** Assets are referenced from `/assets/...` (Vite `base: '/'`).
  Serving from a sub-path needs `base` set in `vite.config.ts`.
- **Caching.** `/assets/*` filenames are content-hashed and safe to cache long;
  `index.html` should not be cached.
- `server.allowedHosts` in `vite.config.ts` affects only the dev server.
- Hosting, TLS and domain are open decisions (docs/PRD.md section 9).

## Languages

The UI is available in English (`en`), Kannada (`kn`) and Hindi (`hi`):

- **Where to choose:** language chips on every customer screen (QR and kiosk), and a select in the merchant and kitchen headers.
- **Persistence:** the choice is stored in `localStorage` (`vop.language`) and restored on reload. A missing or invalid value means English.
- **No side effects:** switching never resets the cart, the ordering session or an order. `<html lang>` follows the choice.
- **Assistant:** the same language is sent with each conversation turn.
- **Dictionaries:** strings live in `src/i18n/` (`en.ts` is the typed source; `kn.ts`, `hi.ts`). A key missing from Kannada or Hindi falls back to English, and `i18n.test.ts` fails if any key or placeholder is missing.
- **Not translated:** backend content is shown exactly as received: menu item names and descriptions, category and outlet names, add-on labels, order data and server error messages.
- **Search:** matches menu text as the backend stores it, so it works in the menu's own language.

## Demo-only and placeholder features

These are clearly labelled on screen and perform no real action:

- **Merchant overview and order list**: sample fixtures (`src/merchant/demoOrders.ts`),
  shown with a "Sample data" banner. "Live data" checks backend health and
  reports that no merchant order API exists.
- **Kitchen display**: the same fixtures, with a DEMO DATA badge. Status buttons
  ("Start preparing", "Mark ready", "Mark collected") are disabled ("Coming soon").
- **Merchant menu**: the real public menu, read-only. Add, edit and availability
  controls are disabled.
- **UPI payment**: no QR code, UPI ID or payment link is shown; the QR area says
  online UPI is not connected. Payment status is only what the server returns.
- **Voice (kiosk)**: no speech client is wired. The microphone shows "not
  available" and typed requests go through the real conversation route.
- **Staff identity**: a placeholder ("Sign-in not available yet").

Real backend flows today: menu, ordering session, server-side cart, quote,
conversation turns, order creation (idempotent) and order tracking.

## Waiting on backend integration

| Dependency | Frontend impact today |
|---|---|
| Staff authentication (open decision) | No sign-in; merchant and kitchen use sample data and perform no action |
| Merchant order list API (`GET /merchant/orders` or similar) | Overview and order list are fixtures |
| Kitchen order feed and status transitions (`PATCH .../status`) | Kitchen board is fixtures; status buttons disabled |
| Merchant menu edit / availability API | Menu page is read-only |
| Payment provider, QR source, verified webhook (open decision) | No online UPI; `pending`/`dueAtCounter` until staff confirm |
| Staff payment confirmation action | Nothing can mark a payment `verified` yet |
| Gnani Prisma STT / Timbre TTS backend routes (schemas unverified) | Voice capture and spoken replies unavailable |
| Order lookup by idempotency state (docs/UX_FLOWS.md flow 3) | After a lost response the client retries with the same key; it cannot query the outcome |
| Order access token on idempotent replay | A replayed confirmation omits `orderAccessToken`, so that order cannot be refreshed live on the customer screen |
| Contract values for "verifying" and "cancelled" payment states | Shown only as labelled placeholders in `#/payment-preview` |

Contracts these screens already depend on are in `shared/src/index.ts`; several are
marked "NEEDS JOINT AGREEMENT" there.
