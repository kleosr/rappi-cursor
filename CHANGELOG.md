# Changelog

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
