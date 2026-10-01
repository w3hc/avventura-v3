# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `POST /start` accepts an optional `difficulty` (`easy`, `hard` or `super-hard`, default `easy`), stored on the game ([#29](https://github.com/w3hc/avventura-v3/issues/29)).
- Steps can end the adventure with `action: "death"` or `"victory"` and no options; `POST /move` on a finished game returns 400 and reaching an ending skips the AI call ([#29](https://github.com/w3hc/avventura-v3/issues/29)).
- Each difficulty adds prompt rules on deadly options, foreshadowing and scarcity; output exceeding its death limit (0, 1 or 2 per step) is regenerated once ([#29](https://github.com/w3hc/avventura-v3/issues/29)).

### Changed

- `start` and `move` share a single Anthropic call helper ([#29](https://github.com/w3hc/avventura-v3/issues/29)).

- Dependencies bumped to their latest versions: NestJS 12, ESLint 10, TypeScript 6, `@types/node` 26, `@types/supertest` 7, dotenv 18, class-validator 0.15, `@swc/cli` 0.8 and minor bumps ([#27](https://github.com/w3hc/avventura-v3/issues/27)).
- NestJS 12 ships as ESM: Jest scripts run with `NODE_OPTIONS=--experimental-vm-modules`, and CI runs on Node 24 with the pnpm version from `packageManager` ([#27](https://github.com/w3hc/avventura-v3/issues/27)).
- `tsconfig.json` follows TypeScript 6 defaults: `baseUrl` removed, `types` and `strict: false` set explicitly. The build keeps emitting to `dist/main.js` ([#27](https://github.com/w3hc/avventura-v3/issues/27)).
- `notes/` is git-ignored ([#27](https://github.com/w3hc/avventura-v3/issues/27)).
