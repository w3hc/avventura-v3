# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- A creator's first story is free: its requests, creation included, are charged to the `platform` ledger owner, tagged with the story, never to the creator's balance or auto top-up, until their total price reaches `FREE_STORY_LIMIT` euros (default `2`, invalid values fall back with a warning). Then `POST /start` and `POST /move` return 402 `Free story limit reached` ([#46](https://github.com/w3hc/avventura-v3/issues/46)).
- `free_stories` table: one free story per address, recorded when the story is saved, so deleting or editing it doesn't grant another. Addresses that own stories on startup get none ([#46](https://github.com/w3hc/avventura-v3/issues/46)).
- `GET /me` marks each story `free` and returns `freeStory`: `{ slug, spent, limit }`, or `null` ([#46](https://github.com/w3hc/avventura-v3/issues/46)).
- `.env.template` lists `FREE_STORY_LIMIT` ([#46](https://github.com/w3hc/avventura-v3/issues/46)).
- The README explains the free first story and how to report its cost ([#46](https://github.com/w3hc/avventura-v3/issues/46)).

- `PUT /billing/auto-topup` saves, changes or disables a creator's automatic top-up: an `amount` from €5 to €500 charged when a debit leaves the balance at or below `threshold` (€0 or more), `10` and `5` until set. Saving the settings resumes a paused auto top-up ([#45](https://github.com/w3hc/avventura-v3/issues/45)).
- `POST /billing/auto-topup/setup` returns a Stripe Checkout page in `setup` mode that saves a card, back to `BILLING_RETURN_URL` with `?card=saved` or `?card=cancel`. Its `checkout.session.completed` event stores the card and resumes a paused auto top-up ([#45](https://github.com/w3hc/avventura-v3/issues/45)).
- After each debit, on each 402 and when the settings or card change, an active auto top-up below its threshold records one pending payment per owner in `auto_topup_payments` and charges the saved card off-session in the background, with the idempotency key `auto-topup-<id>`, so a burst of debits charges once ([#45](https://github.com/w3hc/avventura-v3/issues/45)).
- `payment_intent.succeeded` credits an auto top-up's net amount, once per PaymentIntent. A declined card, `authentication_required`, `requires_action` or `payment_intent.payment_failed` pauses auto top-up; a payment that never reached Stripe is retried after 10 minutes with the same idempotency key ([#45](https://github.com/w3hc/avventura-v3/issues/45)).
- `GET /me` returns `autoTopup`: `{ enabled, amount, threshold, hasCard, paused, pausedReason }`, or `null` when never set ([#45](https://github.com/w3hc/avventura-v3/issues/45)).
- `auto_topups` and `auto_topup_payments` tables, created on startup ([#45](https://github.com/w3hc/avventura-v3/issues/45)).
- The README explains auto top-up, how to test it with Stripe test cards, and that the production webhook needs the `payment_intent` events ([#45](https://github.com/w3hc/avventura-v3/issues/45)).

- `POST /billing/checkout` starts a [Stripe Checkout](https://docs.stripe.com/payments/checkout) card payment in EUR for €5 to €500, behind a session, and returns its URL. The session and its PaymentIntent carry `{ kind: 'topup', owner }` metadata, and a paid invoice is created with the footer "TVA non applicable, art. 293 B du CGI" ([#44](https://github.com/w3hc/avventura-v3/issues/44)).
- `POST /billing/webhook` verifies the `Stripe-Signature` header against the raw body (400 when missing or wrong) and, on a paid `topup` `checkout.session.completed`, credits the payment's net, the amount minus the Stripe fee from its balance transaction. A missing balance opens at `100` first ([#44](https://github.com/w3hc/avventura-v3/issues/44)).
- Each Stripe event is processed once: its id is stored in `stripe_events` in the same transaction as the credit, and a PaymentIntent is credited at most once ([#44](https://github.com/w3hc/avventura-v3/issues/44)).
- One Stripe Customer per address, stored in `stripe_customers` and replaced when Stripe no longer has it ([#44](https://github.com/w3hc/avventura-v3/issues/44)).
- `topup` ledger rows from Stripe store the `gross` paid, the `fee` and the `stripe_payment_intent`; existing databases gain these columns on startup ([#44](https://github.com/w3hc/avventura-v3/issues/44)).
- `.env.template` lists `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `BILLING_RETURN_URL` (default `https://avventura.fun/dashboard`); without the first two, billing routes return 503 and the rest of the API works ([#44](https://github.com/w3hc/avventura-v3/issues/44)).
- The README explains how to test billing with the Stripe CLI and set up the production webhook ([#44](https://github.com/w3hc/avventura-v3/issues/44)).

- Each AI call is charged its price, `llmCost × (1 + SERVICE_FEE_RATE)` with `SERVICE_FEE_RATE` defaulting to `0.30`. `llm` ledger rows store the price in `amount` and the LLM cost in `llm_cost`, and game `spent`, the 402 check and `GET /me` `spent` use the price. A negative or non-numeric rate falls back to `0.30` with a warning ([#43](https://github.com/w3hc/avventura-v3/issues/43)).
- `.env.template` lists `SERVICE_FEE_RATE` ([#43](https://github.com/w3hc/avventura-v3/issues/43)).

- `GET /auth/nonce`, `POST /auth/siwe` and `POST /auth/logout`: sign in once with a SIWE message whose statement is `Sign in to Avventura` and a single-use nonce from the API, and get a bearer token for `SESSION_TTL_SECONDS` (default one day) ([#47](https://github.com/w3hc/avventura-v3/issues/47)).
- Nonces and sessions are stored in SQLite in `siwe_nonces` and `sessions`, with only the SHA-256 hash of each token, and survive a restart ([#47](https://github.com/w3hc/avventura-v3/issues/47)).
- `.env.template` lists `SESSION_TTL_SECONDS` ([#47](https://github.com/w3hc/avventura-v3/issues/47)).
- `GET /me` returns the signer's address, balance and owned stories, each with its LLM spend in euros (`spent`), behind a SIWE signature on the request ([#42](https://github.com/w3hc/avventura-v3/issues/42)).
- `POST /credits` tops up an address's balance, protected by `CREDITS_PASSWORD` ([#42](https://github.com/w3hc/avventura-v3/issues/42)).
- `POST /stories` returns 402 Payment Required without calling the AI when the creator's balance is 0 or below ([#42](https://github.com/w3hc/avventura-v3/issues/42)).
- `.env.template` lists `OWNER_ADDRESS` ([#42](https://github.com/w3hc/avventura-v3/issues/42)).
- Story balances and a ledger of every charge, top-up and adjustment are stored in SQLite with [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), at `DATABASE_PATH` (default `data/avventura.db`, git-ignored). Each movement writes its ledger row and updates the balance in one transaction ([#41](https://github.com/w3hc/avventura-v3/issues/41)).
- `pnpm credits:migrate` (`scripts/migrate-credits.mts`) imports each story's `credits` as an opening adjustment and removes the key from `stories/stories.json`; running it again changes nothing ([#41](https://github.com/w3hc/avventura-v3/issues/41)).
- `.env.template` lists `DATABASE_PATH` ([#41](https://github.com/w3hc/avventura-v3/issues/41)).
- `POST /stories` and `POST /stories/edit` require a SIWE signature in the `x-siwe-message` and `x-siwe-signature` headers, checked by `SiweAuthGuard` with [w3pk](https://www.npmjs.com/package/w3pk): chain, optional domain allow-list, expiration window, a statement bound to the request, the signature and a single-use nonce ([#48](https://github.com/w3hc/avventura-v3/issues/48)).
- New stories record the signer as `creatorAddress` ([#48](https://github.com/w3hc/avventura-v3/issues/48)).
- `.env.template` lists `SIWE_CHAIN_ID`, `SIWE_MAX_AGE_SECONDS` and `SIWE_ALLOWED_DOMAINS` ([#48](https://github.com/w3hc/avventura-v3/issues/48)).
- Token rates and the USD to EUR rate are refreshed every day at 06:00 UTC from the official Claude pricing page (through Claude web search) and the ECB rate via Frankfurter, validated and stored in `pricing/pricing.json`, with the previous file archived ([#39](https://github.com/w3hc/avventura-v3/issues/39)).
- `POST /pricing/update` runs the pricing update now, protected by `CREDITS_PASSWORD` ([#39](https://github.com/w3hc/avventura-v3/issues/39)).
- `.env.template` lists `ANTHROPIC_API_KEY` ([#39](https://github.com/w3hc/avventura-v3/issues/39)).
- `.claude/CLAUDE.md` describes the production host, the production and local API URLs, and the frontend that consumes the API ([#37](https://github.com/w3hc/avventura-v3/issues/37)).
- `POST /start` and `POST /move` return 402 Payment Required without calling the AI when the story's `credits` is 0 or below. Moves that reach an ending are still allowed ([#35](https://github.com/w3hc/avventura-v3/issues/35)).
- `pnpm credits:init` (`scripts/init-credits.mts`) sets `credits` to 100 on every story that has none, leaving existing balances unchanged ([#35](https://github.com/w3hc/avventura-v3/issues/35)).
- Stories have a `credits` balance in USD, set to 100 on creation. Each `/start` and `/move` AI call deducts its token cost from it ([#33](https://github.com/w3hc/avventura-v3/issues/33)).
- Games record their total cost in `spent`, which `POST /move` also returns ([#33](https://github.com/w3hc/avventura-v3/issues/33)).
- `POST /stories/credits` tops up a story's credits, protected by `CREDITS_PASSWORD`, and returns the amount added and the new balance ([#33](https://github.com/w3hc/avventura-v3/issues/33)).
- `POST /start` accepts an optional `textLength` (`normal` or `short`, default `normal`), stored on the game ([#31](https://github.com/w3hc/avventura-v3/issues/31)).
- In `short` mode every step `desc` is at most 980 characters: a prompt rule asks for it, output exceeding it is regenerated once, and a still-too-long `desc` is cut at the last sentence end ([#31](https://github.com/w3hc/avventura-v3/issues/31)).
- `POST /start` accepts an optional `difficulty` (`easy`, `hard` or `super-hard`, default `easy`), stored on the game ([#29](https://github.com/w3hc/avventura-v3/issues/29)).
- Steps can end the adventure with `action: "death"` or `"victory"` and no options; `POST /move` on a finished game returns 400 and reaching an ending skips the AI call ([#29](https://github.com/w3hc/avventura-v3/issues/29)).
- Each difficulty adds prompt rules on deadly options, foreshadowing and scarcity; output exceeding its death limit (0, 1 or 2 per step) is regenerated once ([#29](https://github.com/w3hc/avventura-v3/issues/29)).

### Changed

- New balances open at €0 instead of €100, whether opened by a request, `POST /credits` or a Stripe payment; existing balances are kept. `DEFAULT_CREDITS` is removed ([#46](https://github.com/w3hc/avventura-v3/issues/46)).
- On startup, a story with an `ownerAddress` and no `credits` key no longer opens a €100 story balance that moves to its owner; legacy stories keep their amounts ([#46](https://github.com/w3hc/avventura-v3/issues/46)).

- `POST /stories`, `POST /stories/edit` and `GET /me` take `Authorization: Bearer <token>` from `POST /auth/siwe` instead of a SIWE signature per request: the `x-siwe-message` and `x-siwe-signature` headers and `SiweAuthGuard` are removed ([#47](https://github.com/w3hc/avventura-v3/issues/47)).
- A story's owner is stored as `ownerAddress` instead of `creatorAddress`; on startup, a `creatorAddress` key in `stories/stories.json` is renamed, and the file is only written when something changed ([#52](https://github.com/w3hc/avventura-v3/issues/52)).
- `DEFAULT_OWNER_ADDRESS` replaces `OWNER_ADDRESS` as the owner of stories without an `ownerAddress` ([#52](https://github.com/w3hc/avventura-v3/issues/52)).
- Errors, Swagger descriptions and logs say "owner" instead of "creator", such as 403 "Only the story owner can edit it" ([#52](https://github.com/w3hc/avventura-v3/issues/52)).
- Balances belong to the story's creator (`creatorAddress`) instead of the story: one balance per address, charged by every story it owns. Stories without a `creatorAddress` belong to `OWNER_ADDRESS`. Ledger rows keep the story they were charged for ([#42](https://github.com/w3hc/avventura-v3/issues/42)).
- Story creation is priced from the tokens it used, written to `costs.json` and charged to the creator, even when the response is not a valid story ([#42](https://github.com/w3hc/avventura-v3/issues/42)).
- On startup, each story's balance moves to its owner as a pair of `adjustment` ledger rows, keeping the total; a story whose balance is already 0 is skipped, so restarting moves nothing ([#42](https://github.com/w3hc/avventura-v3/issues/42)).
- A new address opens its balance at 100, instead of each new story ([#42](https://github.com/w3hc/avventura-v3/issues/42)).
- `POST /start`, `POST /move` and `POST /stories/credits` read and update the story's balance in the database instead of its `credits` key in `stories/stories.json`. New stories open their balance at 100 in the database ([#41](https://github.com/w3hc/avventura-v3/issues/41)).
- `POST /stories/edit` returns 403 unless the signer is the story's `creatorAddress`, and ignores updates to `creatorAddress`, `credits`, `sessions`, `requests` and `created_at` ([#48](https://github.com/w3hc/avventura-v3/issues/48)).
- Costs, `credits`, `spent` and `costs.json` are in euros, priced from the current rates instead of hardcoded USD rates. Existing balances are kept as they are ([#39](https://github.com/w3hc/avventura-v3/issues/39)).
- The AI model is `claude-sonnet-5-5` with thinking off (`between_tools`), and costs are priced at its rates ([#33](https://github.com/w3hc/avventura-v3/issues/33)).
- The single retry on broken difficulty rules also covers the text length limit ([#31](https://github.com/w3hc/avventura-v3/issues/31)).
- `start` and `move` share a single Anthropic call helper ([#29](https://github.com/w3hc/avventura-v3/issues/29)).

- Dependencies bumped to their latest versions: NestJS 12, ESLint 10, TypeScript 6, `@types/node` 26, `@types/supertest` 7, dotenv 18, class-validator 0.15, `@swc/cli` 0.8 and minor bumps ([#27](https://github.com/w3hc/avventura-v3/issues/27)).
- NestJS 12 ships as ESM: Jest scripts run with `NODE_OPTIONS=--experimental-vm-modules`, and CI runs on Node 24 with the pnpm version from `packageManager` ([#27](https://github.com/w3hc/avventura-v3/issues/27)).
- `tsconfig.json` follows TypeScript 6 defaults: `baseUrl` removed, `types` and `strict: false` set explicitly. The build keeps emitting to `dist/main.js` ([#27](https://github.com/w3hc/avventura-v3/issues/27)).
- `notes/` is git-ignored ([#27](https://github.com/w3hc/avventura-v3/issues/27)).

### Removed

- `POST /stories/credits`, replaced by `POST /credits` ([#42](https://github.com/w3hc/avventura-v3/issues/42)).
- `pnpm credits:migrate` and `scripts/migrate-credits.mts`: the startup migration imports a story's `credits` key when it has no balance yet ([#42](https://github.com/w3hc/avventura-v3/issues/42)).
- `pnpm credits:init` and `scripts/init-credits.mts`, replaced by `pnpm credits:migrate` ([#41](https://github.com/w3hc/avventura-v3/issues/41)).

### Fixed

- The README's `stripe listen` command passes `--events checkout.session.completed,payment_intent.succeeded,payment_intent.payment_failed`, which current Stripe CLI versions require, and explains how to resend an event missed while it was stopped ([#60](https://github.com/w3hc/avventura-v3/issues/60)).
