# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

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

- The AI model is `claude-sonnet-5-5` with thinking off (`between_tools`), and costs are priced at its rates ([#33](https://github.com/w3hc/avventura-v3/issues/33)).
- The single retry on broken difficulty rules also covers the text length limit ([#31](https://github.com/w3hc/avventura-v3/issues/31)).
- `start` and `move` share a single Anthropic call helper ([#29](https://github.com/w3hc/avventura-v3/issues/29)).

- Dependencies bumped to their latest versions: NestJS 12, ESLint 10, TypeScript 6, `@types/node` 26, `@types/supertest` 7, dotenv 18, class-validator 0.15, `@swc/cli` 0.8 and minor bumps ([#27](https://github.com/w3hc/avventura-v3/issues/27)).
- NestJS 12 ships as ESM: Jest scripts run with `NODE_OPTIONS=--experimental-vm-modules`, and CI runs on Node 24 with the pnpm version from `packageManager` ([#27](https://github.com/w3hc/avventura-v3/issues/27)).
- `tsconfig.json` follows TypeScript 6 defaults: `baseUrl` removed, `types` and `strict: false` set explicitly. The build keeps emitting to `dist/main.js` ([#27](https://github.com/w3hc/avventura-v3/issues/27)).
- `notes/` is git-ignored ([#27](https://github.com/w3hc/avventura-v3/issues/27)).
