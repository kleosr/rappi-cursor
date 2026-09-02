# Agent Handbook

Operational handbook for autonomous coding agents working on `rappi-cursor`.

## Rules

- Target environment and scope: Unofficial Cursor/VS Code extension (`kleosr.rappi-cursor`) wrapping consumer Grability HTTP APIs (`services.grability.rappi.com`) with an MCP server (14 tools) and sidebar webview UI.
- API boundary: Do not implement the Partner Dev Portal Aliados API (`dev-portal.rappi.com/api/es/`) or rappi-cli local Hono REST facade (`/api/*`). Keep communication scoped to consumer Grability and MCP tools.
- Safety & confirmations: Never execute `place_order` or active address changes without explicit human confirmation. Live e2e runs must never invoke `place_order`.
- Credentials & secrets: Tokens must never be committed. Credentials live in VS Code SecretStorage and local bridge file `~/.config/rappi-cursor/config.json` (mode 0600).
- HTTP & Cart semantics:
  - Do not `encodeURIComponent` product IDs in `removeFromCart`.
  - Look up cart by product ID (`findCartForProduct`); do not assume restaurant cart.
  - When DELETE fails with 404 on `store_type`, retry using `store_type_origin`.
  - Support empty 2xx HTTP bodies on `del()`.
  - Gate `placeOrder` execution on `store.valid`.
- UI & Tokens: Follow `DESIGN.md` tokens. Use `--rappi-accent` (`#FF441F`) and `--rappi-accent-hover` (`#E03A1A`). Keep monochrome activity bar SVG mask and standard VS Code theme variables for surfaces/text. Hairline dividers only, no card shadows.

## Skills

Reusable task recipes belong in `.agents/skills`. This repository does not define custom local skills today.

## Workflows

- Prerequisites: Node.js (v20+ recommended), npm. Run `npm install` or `npm ci` before building.
- Build:
  - `npm run compile`: Compile TypeScript with project config (`tsc -p ./`).
  - `npm run watch`: Incremental TypeScript compilation in watch mode.
  - `npm run package`: Package extension vsix archive via `@vscode/vsce`.
- Validation & Testing:
  - `npm run check`: Primary CI/gate command (`npm run compile && node scripts/smoke.mjs && npm run e2e`).
  - `npm run e2e`: Run offline mocks covering all Grability service endpoints. If `~/.config/rappi-cursor/config.json` exists with a token, executes read-only live checks (whoami, get_cart, search).
  - Optional live remove test: `RAPPI_E2E_REMOVE=1 npm run e2e`.
- Run MCP Server:
  - `npm run mcp`: Run compiled MCP stdio server from `./out/mcp/server.js`.

## Memory

No persistent docs memory is configured in this repository. Versioned memory files belong under `docs/` when introduced. Vendor-specific memory systems are prohibited.
