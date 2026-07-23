# Changelog

## 0.1.3

- Harden `removeFromCart`: fuzzy product id match, DELETE `store_type` then `store_type_origin` on 404, list available ids when missing
- Harden HTTP `del`: empty 2xx body OK; include response snippet on DELETE errors
- Offline e2e for all Grability paths (`npm run e2e`, wired into `npm run check`); live gate when bridge token exists (never `place_order`)
- README: extension = consumer Grability + MCP/UI — not Dev Portal Aliados or CLI Hono `/api/*`

## 0.1.2

- Activity bar icon: monochrome Rappi wordmark (VS Code/Cursor tint mask; no solid orange tile)

## 0.1.1

- Official Rappi wordmark / activity icon / marketplace icon (`#FF441F`)
- Fix remove-from-cart wrong `store_type` 404 (lookup cart by product id)
- MCP/sidebar config coords stay in sync after `set_address`
- Login syncs active address coordinates; place_order gates on `store.valid`

## 0.1.0

- Initial Cursor/VS Code extension wrapper of rappi-cli APIs
- Sidebar: browse, cart, checkout, orders, addresses
- Background sync (interval + window focus) with status bar
- SecretStorage credentials + MCP bridge file
- MCP server with 14 upstream-parity tools
- Modal confirmation before place-order and set-address
