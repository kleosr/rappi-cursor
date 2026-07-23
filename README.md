# rappi-cursor

Extension de Cursor/VS Code para pedir en Rappi sin abrir la app a cada rato.

La arme por flojera. Me dio ladilla estar buscando en el telefono. Si te sirve, bien. Si no, tambien. MIT, haz lo que quieras.

No es oficial de Rappi. Es un wrapper encima de la misma API web que usa [rappi-cli](https://github.com/crafter-station/rappi-cli).

## Que hace

- Sidebar con Browse / Cart / Checkout / Orders / Account
- Sync cada 30s del carrito y pedidos (status bar incluido)
- Comando `Rappi: Iniciar sesion` para meter tu token
- MCP con 14 tools para que el Agent de Cursor tambien pueda buscar y armar pedido

Flujo tipico: iniciar sesion -> buscar -> toppings si toca -> carrito -> preview -> confirmar -> place order -> track.

Place order y cambiar direccion te piden confirmacion. No te va a cobrar por accidente solo porque el Agent se emociono.

## Como sacar el Authorization Bearer (esto es lo unico que importa)

El token no esta en Local Storage. No busques ahi. Esta en el header de un GET a la API.

1. Entra a https://www.rappi.com.co e inicia sesion (telefono / WhatsApp).
2. Abre DevTools: `F12` o click derecho -> Inspeccionar.
3. Pestaña **Network**.
4. Filtra por `grability` (o escribe `services.grability.rappi.com`).
5. Recarga o navega un poco (home, direcciones, lo que sea).
6. Click en un request **GET** que diga `auth` (o `addresses`, o `is-prime`). No elijas **OPTIONS**. OPTIONS es basura CORS.
7. Pestaña **Headers**.
8. Baja a **Request Headers**.
9. Copia **Authorization**.

Se ve mas o menos asi:

```http
Authorization: Bearer ft.gAAAAA...
```

Pegas eso en la extension (con o sin la palabra `Bearer`, da igual).

Opcional: en el mismo request copia el header `deviceid`. Si no lo pegas, la extension inventa uno.

Token tipico empieza por `ft.gAAAAA`. Si ves otra cosa, te equivocaste de request.

## Instalar

Desde el `.vsix` de un release:

```bash
cursor --install-extension rappi-cursor-0.1.0.vsix --force
```

O desde el source:

```bash
git clone https://github.com/kleosr/rappi-cursor.git
cd rappi-cursor
npm install
npm run compile
npm run package
cursor --install-extension rappi-cursor-0.1.0.vsix --force
```

Reload Window. Icono naranja Rappi en la barra. Dale a **Iniciar sesion en Rappi** y pega el token.

## MCP (Agent)

Despues del login, el token queda tambien en `~/.config/rappi-cursor/config.json` (permisos 0600) para el MCP.

```json
{
  "mcpServers": {
    "rappi": {
      "command": "node",
      "args": ["/ruta/a/rappi-cursor/out/mcp/server.js"]
    }
  }
}
```

Si instalaste el vsix, la ruta suele ser algo como:

`~/.cursor/extensions/kleosr.rappi-cursor-0.1.0/out/mcp/server.js`

Tools: `whoami`, `search`, `list_restaurants`, `get_store`, `get_product_options`, `add_to_cart`, `remove_from_cart`, `get_cart`, `checkout_preview`, `set_tip`, `place_order`, `track_orders`, `list_addresses`, `set_address`.

Antes de `place_order` o `set_address`, confirma con el humano. En serio.

## Desarrollo

```bash
npm install
npm run check
npm run watch
```

F5 con el launch de extension host si estas en el repo.

## Seguridad

- El token vive en SecretStorage de Cursor y en el bridge local. No lo subas a git.
- Expira. Cuando falle el auth, vuelve a `Rappi: Iniciar sesion`.
- Esto usa la API no documentada de Rappi. Se puede romper manana. Ni modo.

## Licencia

MIT. Copyright (c) 2026 kleosr.

El core de llamadas viene de / esta inspirado en rappi-cli (MIT). Ver `NOTICE`.

Rappi es marca de ellos. Esto no tiene nada que ver con la empresa. Lo hice porque me dio flojera. Ya.
