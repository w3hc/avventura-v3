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

## License

GPL-3.0

## Contact

**Julien Béranger** ([GitHub](https://github.com/julienbrg))

- Element: [@julienbrg:matrix.org](https://matrix.to/#/@julienbrg:matrix.org)
- Farcaster: [julien-](https://warpcast.com/julien-)
- Telegram: [@julienbrg](https://t.me/julienbrg)

---

<img src="https://bafkreid5xwxz4bed67bxb2wjmwsec4uhlcjviwy7pkzwoyu5oesjd3sp64.ipfs.w3s.link" alt="built-with-ethereum-w3hc" width="100"/>
