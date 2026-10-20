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

Each story in `stories/stories.json` has a `credits` balance in euros, set to `100` when the story is created. A story without the key counts as having `100`.

Every AI call made by `POST /start` and `POST /move` is priced in euros from the tokens it used (input, cache writes, cache reads and output, at the current `claude-sonnet-5-5` rates, see [Pricing](#pricing)). That amount is subtracted from the story's `credits` and added to the game's `spent` key in `games/<id>.json`. `POST /move` returns the game's `spent` total.

When a story's `credits` is `0` or below, `POST /start` and `POST /move` return `402 Payment Required` without calling the AI. A move that reaches an ending is still allowed, since it costs nothing. The last request before running out can take the balance slightly below zero.

To give `100` credits to every story that has no `credits` key yet (existing balances are left unchanged):

```bash
pnpm credits:init
```

Top up a story with `POST /stories/credits`:

```bash
curl -X POST localhost:3000/stories/credits \
  -H 'Content-Type: application/json' \
  -d '{"slug": "montpellier", "amount": 20, "password": "..."}'
# {"added": 20, "credits": 117.42}
```

The password is `CREDITS_PASSWORD` from `.env`. A wrong password returns 401, an unknown slug 404.

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
