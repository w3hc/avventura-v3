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

Each story creator has one balance in euros, keyed by their lowercased address (the story's `creatorAddress`). Stories without a `creatorAddress` belong to `OWNER_ADDRESS`. A new address opens its balance at `100`. Players never sign in: playing a story charges its creator.

Balances live in a SQLite database at `DATABASE_PATH` (default `data/avventura.db`), created on startup with two tables:

- `balances`: one row per owner with its current amount
- `ledger`: one row per movement, with the owner, story, game, kind (`llm`, `topup` or `adjustment`), LLM cost, amount and date

Amounts are stored in micro-euros. Every charge and top-up writes its ledger row and updates the balance in a single transaction, so a balance always equals the sum of its ledger, even under concurrent requests.

Every AI call made by `POST /stories`, `POST /start` and `POST /move` is priced in euros from the tokens it used (input, cache writes, cache reads and output, at the current `claude-sonnet-5-5` rates, see [Pricing](#pricing)). That amount is charged to the story's owner as an `llm` ledger row tagged with the story. `POST /start` and `POST /move` also add it to the game's `spent` key in `games/<id>.json`, and `POST /move` returns the game's `spent` total. Story creation is charged even when the AI response isn't a valid story, since the call was paid for.

When the owner's balance is `0` or below, `POST /stories`, `POST /start` and `POST /move` return `402 Payment Required` without calling the AI. A move that reaches an ending is still allowed, since it costs nothing. The last request before running out can take the balance slightly below zero.

On startup, each story's balance moves to its owner as two `adjustment` ledger rows, one taking it from the story and one giving it to the owner, so totals don't change. A story with no balance yet is first opened from its `credits` key in `stories/stories.json` (`100` without the key). A story already at `0` is skipped, so restarting moves nothing. Without `OWNER_ADDRESS`, stories that have no `creatorAddress` are skipped with a warning and return 402.

Top up an address with `POST /credits`:

```bash
curl -X POST localhost:3000/credits \
  -H 'Content-Type: application/json' \
  -d '{"address": "0x1111111111111111111111111111111111111111", "amount": 20, "password": "..."}'
# {"added": 20, "credits": 117.42}
```

The password is `CREDITS_PASSWORD` from `.env`. A wrong password returns 401, an invalid address 400.

`GET /me` returns the signer's account, with a SIWE signature whose statement is `Authorize GET /me` (see [Story ownership](#story-ownership)):

```json
{
  "address": "0x1111111111111111111111111111111111111111",
  "balance": 117.42,
  "stories": [{ "slug": "montpellier", "title": "Montpellier", "spent": 2.58 }]
}
```

`spent` is the total of the story's `llm` charges in euros.

## Story ownership

Creating and editing a story, and `GET /me`, need a [Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361) (SIWE) signature on each request, sent in two headers:

- `x-siwe-message`: the SIWE message, percent-encoded (`encodeURIComponent`), whose statement is `Authorize <METHOD> <path>` for this exact request, such as `Authorize POST /stories` or `Authorize POST /stories/edit`
- `x-siwe-signature`: the signature of that message

The message must be on chain `SIWE_CHAIN_ID` (default `1`), have an `expirationTime` at most `SIWE_MAX_AGE_SECONDS` (default `300`) after its `issuedAt`, and use a nonce that hasn't been seen before. When `SIWE_ALLOWED_DOMAINS` is set (comma-separated, such as `avventura.fun,localhost:3001`), its domain must be one of them. Anything else returns 401.

`POST /stories` stores the signer's lowercased address as the story's `creatorAddress` in `stories/stories.json`. `POST /stories/edit` returns 403 unless the signer is that address, and ignores updates to `creatorAddress`, `credits`, `sessions`, `requests` and `created_at`. A story without `creatorAddress`, such as one created before this check, can't be edited until the key is set by hand.

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

---

<img src="https://bafkreid5xwxz4bed67bxb2wjmwsec4uhlcjviwy7pkzwoyu5oesjd3sp64.ipfs.w3s.link" alt="built-with-ethereum-w3hc" width="100"/>
