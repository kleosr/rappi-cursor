# rappi-cursor

Cursor/VS Code extension to order from Rappi without opening the app every five minutes.

I built it out of laziness. Phone search got annoying. If it helps you, cool. If not, also fine. MIT — do what you want.

Unofficial. Not from Rappi. Wrapper over the same web API that [rappi-cli](https://github.com/crafter-station/rappi-cli) uses.

## What it does

- Sidebar: Browse / Cart / Checkout / Orders / Account
- Sync every 30s for cart and orders (status bar included)
- Command `Rappi: Iniciar sesion` to paste your token
- MCP with 14 tools so Cursor Agent can search and build an order too

Typical flow: sign in → search → toppings if needed → cart → preview → confirm → place order → track.

Place order and address changes ask for confirmation. It will not charge you just because the Agent got excited.

## How to grab the Authorization Bearer (this is the only part that matters)

The token is not in Local Storage. Do not look there. It is in the header of a GET to the API.

1. Go to https://www.rappi.com.co and sign in (phone / WhatsApp).
2. Open DevTools: `F12` or right-click → Inspect.
3. **Network** tab.
4. Filter by `grability` (or type `services.grability.rappi.com`).
5. Reload or click around (home, addresses, whatever).
6. Click a **GET** request named `auth` (or `addresses`, or `is-prime`). Not **OPTIONS**. OPTIONS is CORS noise.
7. **Headers** tab.
8. Scroll to **Request Headers**.
9. Copy **Authorization**.

Looks roughly like:

```http
Authorization: Bearer ft.gAAAAA...
```

Paste that into the extension (with or without the word `Bearer` — either works).

Optional: from the same request, copy the `deviceid` header. If you skip it, the extension invents one.

A real token usually starts with `ft.gAAAAA`. If you see something else, you picked the wrong request.

## Install

From a release `.vsix`:

```bash
cursor --install-extension rappi-cursor-0.1.0.vsix --force
```

Or from source:

```bash
git clone https://github.com/kleosr/rappi-cursor.git
cd rappi-cursor
npm install
npm run compile
npm run package
cursor --install-extension rappi-cursor-0.1.0.vsix --force
```

Reload Window. Orange Rappi icon in the activity bar. Hit **Iniciar sesion en Rappi** and paste the token.

## MCP (Agent)

After login, the token is also written to `~/.config/rappi-cursor/config.json` (mode 0600) for MCP.

```json
{
  "mcpServers": {
    "rappi": {
      "command": "node",
      "args": ["/path/to/rappi-cursor/out/mcp/server.js"]
    }
  }
}
```

If you installed the vsix, the path is usually something like:

`~/.cursor/extensions/kleosr.rappi-cursor-0.1.0/out/mcp/server.js`

Tools: `whoami`, `search`, `list_restaurants`, `get_store`, `get_product_options`, `add_to_cart`, `remove_from_cart`, `get_cart`, `checkout_preview`, `set_tip`, `place_order`, `track_orders`, `list_addresses`, `set_address`.

Before `place_order` or `set_address`, confirm with a human. Seriously.

## Development

```bash
npm install
npm run check
npm run watch
```

F5 with the extension host launch if you are in the repo.

## Security

- The token lives in Cursor SecretStorage and the local bridge file. Do not commit it.
- It expires. When auth fails, run `Rappi: Iniciar sesion` again.
- This uses Rappi’s undocumented API. It can break tomorrow. Oh well.

## License

MIT. Copyright (c) 2026 kleosr.

Core HTTP calls come from / are inspired by rappi-cli (MIT). See `NOTICE`.

Rappi is their trademark. This has nothing to do with the company. I made it because I was lazy. That is it.
