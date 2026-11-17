# dsh-plugin-hub-ru Contributor Guide

Russian localization fork (`dsh-plugin`, v2.3.9) of the DSH Plugin Hub marketplace with `en -> ru -> zh` UI switching. See [NOTES.md](NOTES.md), [README.md](README.md), [README.en.md](README.en.md), and [../AGENTS.md](../AGENTS.md).

## Layout

- `src/server/`, `src/client/`: TypeScript sources (including `src/server/web-route-auth.ts` and `installTask` XState machine).
- `lib/`: compiled server output (`tsc -p tsconfig.server.json`), including `lib/index.js` and `lib/web-route-auth.js`.
- `client/client.js` + `client/client.js.map`: shipped browser bundle patched by `scripts/apply-ru.py`.
- `scripts/`: `apply-ru.py` (idempotent Russian dictionary injector), `smoke.ts` (locale/language verification).
- `test/`, `tests/`: `web-route-auth.test.ts`, `install-task-machine.test.ts`.

## Invariants

- **Fail-closed auth:** Private HTTP routes must pass through `src/server/web-route-auth.ts` (`lib/web-route-auth.js`), enforcing native DSH admission before loopback fallback when LAN mode is active.
- **Language behavior:** UI toggle cycles `en -> ru -> zh -> en`; data queries stay `lang=en` (except `zh`); Node host messages (system logs, install errors, issue templates) remain in original English.
- **Upstream self-update hazard:** Clicking Hub's built-in self-update overwrites this fork from npm and loses the Russian dictionary; re-run `scripts/apply-ru.py` or reinstall from workstation if overwritten.
- **Committed `lib/` and `client/`:** Commit compiled `lib/` and `client/client.js` after changes.

## Verification

```sh
npm ci
npm run check               # typecheck (client, server, test), node --test, build
npm run check:distribution  # node --check lib/index.js && node scripts/smoke.ts && node --test test/*.test.ts
```

Sync `../machines` if the `installTask` machine changes, and update `../repositories.json` snapshot metadata when files here change.
