# ChatGPT project context

This directory is a local mirror of the ChatGPT project “Gnani AI”.

- Treat every file under `sources/` as read-only reference material.
- Do not edit, rename, move, or delete synced project files.
- These files may be replaced the next time a task is created from this ChatGPT project.


## Project instructions

- Read `docs/AGENTS.md` and the relevant product, architecture, API, security, UX, and testing documents before implementation.
- Sarvam AI Sarvam 105B Conversations (`sarvam-105b-conversations`) is the planned primary conversational LLM behind a replaceable provider adapter. Do not make a live API call or assume introductory credits exist until Ayush confirms the dashboard balance.
- Gnani Prisma STT and Gnani Timbre TTS remain the planned speech providers; their APIs and credentials are separate from the conversational LLM and remain unverified.
- One shared conversational layer serves QR and kiosk clients. The backend remains authoritative for menu data, availability, prices, cart validation, quotes, order creation, payments, and pickup tokens.
- Customers may request recommendations whenever they ask. Proactive recommendations are limited to one per ordering session, never during review, confirmation, or payment, and stop for that session after a decline.
- Model output is untrusted. Expose only allowlisted tools; validate every call and argument in backend services. The model cannot confirm orders, change payment state, or bypass customer review.
- Touch ordering must still support completion if the model, speech provider, network, or available API credits fail.
- Keep all provider secrets server-side, and do not modify synced reference material under `sources/`.
