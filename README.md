# Avventura

Web3 social RPG.

## Install

```bash
pnpm i
```

## Run

```bash
pnpm start
```

## Test

```bash
pnpm test
```

End-to-end test: 

```
pnpm test:e2e
```

## Difficulty

`POST /start` takes an optional `difficulty`:

| Level | Deadly options per step | Feel |
| --- | --- | --- |
| `easy` (default) | 0 | setbacks only, plenty of resources |
| `hard` | ≤ 1 | danger is foreshadowed, limited resources |
| `super-hard` | ≤ 2 | subtle or misleading warnings, scarce resources |

A step with `action` set to `death` or `victory` ends the game: it has no options, and further moves return 400.

## Text length

`POST /start` takes an optional `textLength`:

| Mode | Step `desc` length |
| --- | --- |
| `normal` (default) | no limit |
| `short` | at most 980 characters, spaces and punctuation included |

In `short` mode, a `desc` over the limit triggers one regeneration; if it is still too long, it is cut at the last sentence end that fits.

## Credits

Each story owner has one balance in euros, keyed by their lowercased address (the story's `ownerAddress`). Stories without an `ownerAddress` belong to `DEFAULT_OWNER_ADDRESS`. A new address opens its balance at `0`, and existing balances are kept. Players never sign in: playing a story charges its owner, except for a creator's free first story (see [Free first story](#free-first-story)).

Balances live in a SQLite database at `DATABASE_PATH` (default `data/avventura.db`), created on startup with two tables:

- `balances`: one row per owner with its current amount
- `ledger`: one row per movement, with the owner, story, game, kind (`llm`, `topup` or `adjustment`), LLM cost, amount and date. An `llm` row's amount is the price charged, its LLM cost what the AI call cost, so the margin is their difference. A Stripe top-up's row also stores the `gross` paid, the Stripe `fee` and the `stripe_payment_intent`, and its amount is the net (see [Billing](#billing))

Amounts are stored in micro-euros. Every charge and top-up writes its ledger row and updates the balance in a single transaction, so a balance always equals the sum of its ledger, even under concurrent requests.

Every AI call made by `POST /stories`, `POST /start` and `POST /move` is priced in euros from the tokens it used (input, cache writes, cache reads and output, at the current `claude-sonnet-5-5` rates, see [Pricing](#pricing)). Its price adds the service fee: `price = llmCost × (1 + SERVICE_FEE_RATE)`, where `SERVICE_FEE_RATE` is a fraction (default `0.30`, so 30%). A missing or empty rate uses the default; a negative or non-numeric one also uses it, with a warning in the logs. The price is charged to the story's owner as an `llm` ledger row tagged with the story. `POST /start` and `POST /move` also add it to the game's `spent` key in `games/<id>.json`, and `POST /move` returns the game's `spent` total. Story creation is charged even when the AI response isn't a valid story, since the call was paid for.

When the owner's balance is `0` or below, `POST /stories` (after the free first story), `POST /start` and `POST /move` return `402 Payment Required` without calling the AI. A move that reaches an ending is still allowed, since it costs nothing. The last request before running out can take the balance slightly below zero.

On startup, each story's balance moves to its owner as two `adjustment` ledger rows, one taking it from the story and one giving it to the owner, so totals don't change. A story with no balance yet is first opened from its `credits` key in `stories/stories.json`, or at `100` when it has neither that key nor an `ownerAddress`, as stories created before credits did. A story with an `ownerAddress` and no `credits` key was created after balances moved to owners and has nothing to move. A story already at `0` is skipped, so restarting moves nothing. Without `DEFAULT_OWNER_ADDRESS`, stories that have no `ownerAddress` are skipped with a warning and return 402.

Top up an address with `POST /credits`:

```bash
curl -X POST localhost:3000/credits \
  -H 'Content-Type: application/json' \
  -d '{"address": "0x1111111111111111111111111111111111111111", "amount": 20, "password": "..."}'
# {"added": 20, "credits": 20}
```

The password is `CREDITS_PASSWORD` from `.env`. A wrong password returns 401, an invalid address 400.

`GET /me` returns the signed-in account, with a bearer token (see [Story ownership](#story-ownership)):

```json
{
  "address": "0x1111111111111111111111111111111111111111",
  "balance": 17.42,
  "stories": [
    { "slug": "montpellier", "title": "Montpellier", "spent": 1.2, "free": true },
    { "slug": "kingston", "title": "Kingston", "spent": 2.58, "free": false }
  ],
  "freeStory": { "slug": "montpellier", "spent": 1.2, "limit": 2 },
  "autoTopup": {
    "enabled": true,
    "amount": 10,
    "threshold": 5,
    "hasCard": true,
    "paused": false,
    "pausedReason": null
  }
}
```

`spent` is the total of the story's `llm` charges in euros, service fee included. `free` marks the creator's free story, and `freeStory` gives its spend and `FREE_STORY_LIMIT`, or is `null` when the address has no free story. `autoTopup` is `null` until the account sets it up (see [Auto top-up](#auto-top-up)).

### Free first story

The first story an address creates is free: the platform pays for its requests, creation included, until their total price reaches `FREE_STORY_LIMIT` euros (default `2`; a negative or non-numeric value uses the default, with a warning). `POST /stories` doesn't check the creator's balance for it.

The free story is recorded in the `free_stories` table when it is saved, one per address, so deleting or editing it doesn't grant another one, and a creation that fails leaves it to the next one. Addresses that already own stories on startup get none. Its `llm` ledger rows are charged to the `platform` owner, tagged with the story, so the creator's balance and auto top-up are never touched and the cost of free stories can be reported with:

```sql
SELECT story, -SUM(amount) / 1e6 AS price_eur, SUM(llm_cost) / 1e6 AS llm_cost_eur
FROM ledger WHERE owner = 'platform' GROUP BY story;
```

Once its total price reaches the limit, `POST /start` and `POST /move` on the free story return `402 Payment Required` (`Free story limit reached`) without calling the AI, and it stays stopped: it doesn't fall back to the creator's balance. The request that crosses the limit can take it slightly above. Later stories are billed to the creator as usual.

## Billing

Creators top up their balance with [Stripe Checkout](https://docs.stripe.com/payments/checkout). Set in `.env`:

- `STRIPE_SECRET_KEY`: the secret API key (`sk_test_...` in test mode)
- `STRIPE_WEBHOOK_SECRET`: the webhook endpoint's signing secret (`whsec_...`)
- `BILLING_RETURN_URL`: where Checkout sends the creator back (default `https://avventura.fun/dashboard`), with `?topup=success` or `?topup=cancel`

Without `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`, the billing routes return 503 and the rest of the API works as usual.

`POST /billing/checkout`, with a bearer token (see [Story ownership](#story-ownership)), takes an amount in euros, from `5` to `500` with at most two decimals, and returns the Checkout page URL:

```bash
curl -X POST localhost:3000/billing/checkout \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"amount": 20}'
# {"url": "https://checkout.stripe.com/c/pay/cs_test_..."}
```

The session is a card payment in EUR for one "Avventura credits" item, with metadata `{ "kind": "topup", "owner": "<address>" }` on the session and its PaymentIntent. It creates a paid invoice with the footer "TVA non applicable, art. 293 B du CGI"; no VAT is charged. Each address has one Stripe Customer, created on its first checkout and stored in the `stripe_customers` table. If Stripe no longer has it, for example after switching from test to live keys, a new one replaces it.

Stripe then calls `POST /billing/webhook`, which checks the `Stripe-Signature` header against the raw body (400 when missing or wrong). On `checkout.session.completed` for a paid `topup` session, it reads the payment's [balance transaction](https://docs.stripe.com/api/balance_transactions/object) and credits its net, the amount paid minus the Stripe fee, so the creator pays the fee. A balance that doesn't exist yet opens at `0` first, like `POST /credits`. Other events and sessions are acknowledged and ignored.

Each event is processed once: its id goes into the `stripe_events` table in the same transaction as the credit, so a replayed event credits nothing, and a PaymentIntent is never credited twice. If the payment's balance transaction isn't available yet, the webhook returns 500 and Stripe retries it later.

### Auto top-up

A creator can have their saved card charged automatically when their balance runs low, so stories don't stop with a 402.

`PUT /billing/auto-topup`, with a bearer token, saves the settings and returns them in the shape `GET /me` reports under `autoTopup`:

```bash
curl -X PUT localhost:3000/billing/auto-topup \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"enabled": true, "amount": 10, "threshold": 5}'
# {"enabled": true, "amount": 10, "threshold": 5, "hasCard": false, "paused": false, "pausedReason": null}
```

`amount` is charged in euros, from `5` to `500` with at most two decimals, whenever a debit leaves the balance at or below `threshold` (`0` or more). Both are optional: left out, the stored values are kept, `10` and `5` at first. `{"enabled": false}` disables it. Saving the settings also resumes a paused auto top-up.

`POST /billing/auto-topup/setup` returns the URL of a Checkout page in `setup` mode, where the creator saves a card without paying. It returns to `BILLING_RETURN_URL` with `?card=saved` or `?card=cancel`. Its `checkout.session.completed` event stores the card's PaymentMethod for the owner, from the session's SetupIntent, and resumes a paused auto top-up. Saving a card or the settings checks the balance at once.

After each debit, and on each 402, the API checks the owner's settings. When auto top-up is enabled, has a card, isn't paused and the balance is at or below the threshold, it records a pending payment in `auto_topup_payments` (one per owner at a time, in a single transaction, so a burst of debits charges once) and, without delaying the response, creates an off-session PaymentIntent for the amount with the idempotency key `auto-topup-<id>` and metadata `{ "kind": "auto_topup", "owner": "<address>", "pending_id": "<id>" }`.

- `payment_intent.succeeded` credits the net amount as for a Checkout top-up, once per PaymentIntent.
- A refused payment (declined card, `authentication_required`, a PaymentIntent left in `requires_action`) or a `payment_intent.payment_failed` event pauses auto top-up: `GET /me` shows `paused: true` and the Stripe code in `pausedReason`. Stories then stop at `0` as usual, until the creator saves a card or the settings again.
- If Stripe can't be reached, the payment stays pending and is tried again with the same idempotency key on a debit at least 10 minutes later.

Settings and saved cards are stored in the `auto_topups` table.

### Test locally

With the [Stripe CLI](https://docs.stripe.com/stripe-cli), logged in to the test account:

```bash
stripe listen \
  --events checkout.session.completed,payment_intent.succeeded,payment_intent.payment_failed \
  --forward-to localhost:3000/billing/webhook
```

It prints a signing secret (`whsec_...`): set it as `STRIPE_WEBHOOK_SECRET` and start the API with `pnpm start:dev`. Then start a checkout with `POST /billing/checkout`, open the URL and pay with the test card `4242 4242 4242 4242`, any future expiry date and any CVC. The creator's balance in `GET /me` grows by the net amount, and the API logs `POST /billing/webhook`.

Keep `stripe listen` running: an event sent while it is stopped is not forwarded later. Resend it with `stripe events resend <evt_id>` once it runs again; `stripe events list --type checkout.session.completed` lists the recent ones. An event already credited is acknowledged without crediting twice.

`stripe trigger checkout.session.completed` sends a signed event too, but its session has no `topup` metadata, so it only checks that the signature is accepted.

For auto top-up, save the card `4242 4242 4242 4242` through `POST /billing/auto-topup/setup`, enable it with a threshold above the balance and play a move: the balance grows by the net amount. The card `4000 0027 6000 3184` asks for authentication on every payment, so auto top-up pauses with `authentication_required`, and `4000 0000 0000 0341` is saved but declined when charged, which pauses it with `card_declined` ([test cards](https://docs.stripe.com/testing)).

### Production

In the [Stripe Dashboard](https://dashboard.stripe.com/webhooks), add a webhook endpoint at `https://api.avventura.fun/billing/webhook` with the events:

- `checkout.session.completed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`

The two `payment_intent` events credit and pause automatic top-ups; without them an auto top-up is charged but never credited. Set its signing secret as `STRIPE_WEBHOOK_SECRET` on the server, with the live `STRIPE_SECRET_KEY`. The account must settle in EUR: a payment settled in another currency is logged as an error and acknowledged without crediting, to be credited by hand.

## Story ownership

Creating and editing a story, and `GET /me`, need a session from [Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361) (SIWE):

1. `GET /auth/nonce` returns `{ "nonce": "..." }`, valid for `SIWE_MAX_AGE_SECONDS` (default `300`).
2. The wallet signs a SIWE message with that nonce and the statement `Sign in to Avventura`.
3. `POST /auth/siwe` with `{ "message": "...", "signature": "..." }`, the message sent as is in the JSON body, returns `{ "token": "...", "address": "0x...", "expiresAt": "..." }`.
4. Each guarded request sends `Authorization: Bearer <token>`. `POST /auth/logout` with the same header ends the session and returns 204.

```bash
curl localhost:3000/me -H 'Authorization: Bearer <token>'
```

The message must be on chain `SIWE_CHAIN_ID` (default `1`), have an `expirationTime` at most `SIWE_MAX_AGE_SECONDS` after its `issuedAt`, and use a nonce from `GET /auth/nonce` that hasn't expired or been used. When `SIWE_ALLOWED_DOMAINS` is set (comma-separated, such as `avventura.fun,localhost:3001`), its domain must be one of them. Anything else returns 401.

Nonces and sessions are stored in SQLite, next to the balances, so they survive a restart. Only the SHA-256 hash of each token is stored. A session lasts `SESSION_TTL_SECONDS` (default `86400`, one day); an expired or unknown token returns 401.

`POST /stories` stores the session's lowercased address as the story's `ownerAddress` in `stories/stories.json`. `POST /stories/edit` returns 403 unless the session's address is that address, and ignores updates to `ownerAddress`, `credits`, `sessions`, `requests` and `created_at`. A story without `ownerAddress`, such as one created before this check, can't be edited until the key is set by hand. On startup, a `creatorAddress` key left by an earlier version is renamed to `ownerAddress`.

## Pricing

Token rates (USD per million tokens) and the USD to EUR rate live in `pricing/pricing.json`. Until the first update has run, the committed `pricing/default-pricing.json` is used instead.

Every day at 06:00 UTC, the API asks `claude-sonnet-5-5`, with web search, for the current rates on the [official pricing page](https://platform.claude.com/docs/en/about-claude/pricing), and fetches the ECB USD to EUR rate from [Frankfurter](https://frankfurter.dev). Rates that are missing, out of range, or more than 3 times higher or lower than the current ones reject the whole update, keeping the current file. If only Frankfurter fails, the last known USD to EUR rate is kept. The previous file is archived to `pricing/archive/pricing-<date>.json`.

Run the update now with `POST /pricing/update`, protected by `CREDITS_PASSWORD`:

```bash
curl -X POST localhost:3000/pricing/update \
  -H 'Content-Type: application/json' \
  -d '{"password": "..."}'
```

## License

GPL-3.0

## Contact

**Julien Béranger** ([GitHub](https://github.com/julienbrg))

- Element: [@julienbrg:matrix.org](https://matrix.to/#/@julienbrg:matrix.org)
- Farcaster: [julien-](https://warpcast.com/julien-)
- Telegram: [@julienbrg](https://t.me/julienbrg)
