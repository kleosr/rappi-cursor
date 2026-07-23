#!/usr/bin/env node
/**
 * Rappi MCP server for Cursor Agent — tool parity with crafter-station/rappi-cli.
 * Credentials: ~/.config/rappi-cursor/config.json (written by the extension) or RAPPI_CONFIG_PATH.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "../core/config";
import { imageUrl } from "../core/formatters";
import { getUser, isPrime } from "../core/services/auth";
import {
  getAddresses,
  setActiveAddress,
  reverseGeocode,
} from "../core/services/address";
import { search } from "../core/services/search";
import {
  getStoreDetail,
  getRestaurantCatalog,
} from "../core/services/store";
import { getProductToppings } from "../core/services/product";
import {
  addToCart,
  removeFromCart,
  getCarts,
  recalculateCart,
  resolveStoreType,
} from "../core/services/cart";
import { getCheckoutDetail, setTip } from "../core/services/checkout";
import { placeOrder, getOrders } from "../core/services/order";
import { DEFAULT_STORE_TYPE } from "../core/constants";
import { saveConfigToDisk } from "../core/config";

const server = new McpServer({
  name: "rappi",
  version: "0.1.0",
  description: [
    "Order food and groceries from Rappi. All prices are in COP (Colombian Pesos).",
    "",
    "Order flow: search → get_product_options (if has_toppings) → add_to_cart → checkout_preview → confirm with user → place_order → track_orders",
    "",
    "store_type: Some stores (e.g. turbo) are internally mapped to 'restaurant'. Tools that accept store_type auto-resolve this — just pass the store_type from search results or get_cart, no manual mapping needed.",
    "",
    "IMPORTANT: Always confirm with the user before calling place_order or set_address.",
  ].join("\n"),
});

server.tool("whoami", "Get current user profile and Prime status", {}, async () => {
  const config = await loadConfig();
  const [user, prime, address] = await Promise.all([
    getUser(config),
    isPrime(config),
    reverseGeocode(config),
  ]);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            name: user.name,
            email: user.email,
            phone: `${user.country_code}${user.phone}`,
            loyalty: user.loyalty.description,
            is_prime: prime,
            location: address.full_text_to_show || address.original_text,
          },
          null,
          2
        ),
      },
    ],
  };
});

server.tool("list_addresses", "List all saved delivery addresses", {}, async () => {
  const config = await loadConfig();
  const { addresses } = await getAddresses(config);
  const result = addresses.map((a) => ({
    id: a.id,
    address: a.address,
    tag: a.tag,
    active: a.active,
    city: a.city?.city,
    orders: a.count_orders,
  }));
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

server.tool(
  "set_address",
  "Set the active delivery address by ID. Always confirm with the user before changing.",
  { address_id: z.number().describe("Address ID from list_addresses") },
  async ({ address_id }) => {
    const config = await loadConfig();
    const { addresses } = await getAddresses(config);
    const addr = addresses.find((a) => a.id === address_id);
    if (!addr) {
      return {
        content: [{ type: "text", text: `Address ${address_id} not found` }],
      };
    }
    await setActiveAddress(address_id, config);
    config.lat = addr.lat;
    config.lng = addr.lng;
    saveConfigToDisk(config);
    return {
      content: [
        {
          type: "text",
          text: `Address set to: ${addr.tag || addr.address} (${addr.address})`,
        },
      ],
    };
  }
);

server.tool(
  "search",
  "Search for products and stores. Returns store_id, store_type, product_id, price, and has_toppings. If has_toppings is true, call get_product_options before add_to_cart.",
  {
    query: z
      .string()
      .describe("What to search for (e.g. 'hamburguesa', 'pizza')"),
  },
  async ({ query }) => {
    const config = await loadConfig();
    const result = await search(query, config);
    const stores = result.stores.map((s) => ({
      store_id: s.store_id,
      store_name: s.store_name,
      store_type: s.store_type,
      logo: s.logo ? imageUrl(s.logo, "restaurants_logo") : undefined,
      eta: s.eta,
      shipping: s.shipping_cost,
      products: s.products.slice(0, 3).map((p) => ({
        product_id: p.product_id,
        name: p.name,
        price: p.price,
        image: p.image ? imageUrl(p.image) : undefined,
        has_toppings: p.has_toppings,
        in_stock: p.in_stock,
      })),
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(stores, null, 2) }],
    };
  }
);

server.tool(
  "list_restaurants",
  "List nearby restaurants",
  {
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Max restaurants to return"),
  },
  async ({ limit }) => {
    const config = await loadConfig();
    const catalog = await getRestaurantCatalog(config, { limit });
    const stores = catalog.stores.map((s) => ({
      store_id: s.store_id,
      name: s.name,
      logo: s.logo ? imageUrl(s.logo, "restaurants_logo") : undefined,
      eta: s.eta,
      score: s.score,
      shipping: s.shipping_cost,
      available: s.is_available,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(stores, null, 2) }],
    };
  }
);

server.tool(
  "get_store",
  "Get store details and menu",
  { store_id: z.number().describe("Store ID from search or restaurants") },
  async ({ store_id }) => {
    const config = await loadConfig();
    const store = await getStoreDetail(store_id, config);
    return {
      content: [{ type: "text", text: JSON.stringify(store, null, 2) }],
    };
  }
);

server.tool(
  "get_product_options",
  "Get product customization options (toppings) — check before adding to cart",
  {
    store_id: z.number().describe("Store ID"),
    product_id: z.number().describe("Product ID"),
  },
  async ({ store_id, product_id }) => {
    const config = await loadConfig();
    const data = await getProductToppings(store_id, product_id, config);
    const categories = data.categories.map((cat) => ({
      name: cat.description,
      required: cat.min_toppings_for_categories > 0,
      min: cat.min_toppings_for_categories,
      max: cat.max_toppings_for_categories,
      options: cat.toppings.map((t) => ({
        id: t.id,
        name: t.description,
        price: t.price,
        image: t.image ? imageUrl(t.image) : undefined,
        available: t.is_available,
      })),
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(categories, null, 2) }],
    };
  }
);

server.tool(
  "add_to_cart",
  "Add a product to cart. Always search first to get the correct price. If the product has required toppings, call get_product_options first and include topping IDs.",
  {
    store_id: z.number().describe("Store ID"),
    product_id: z.string().describe("Product ID"),
    name: z.string().describe("Product name"),
    quantity: z.number().optional().default(1).describe("Quantity"),
    toppings: z
      .array(z.number())
      .optional()
      .default([])
      .describe("Topping IDs from get_product_options"),
    price: z
      .number()
      .optional()
      .default(0)
      .describe("Product price from search results"),
  },
  async ({ store_id, product_id, name, quantity, toppings, price }) => {
    const config = await loadConfig();
    const result = await addToCart(
      DEFAULT_STORE_TYPE,
      [
        {
          id: store_id,
          products: [
            { id: product_id, name, toppings, units: quantity, price },
          ],
        },
      ],
      config
    );
    const store = result.stores?.[0];
    return {
      content: [
        {
          type: "text",
          text: store
            ? `Added ${name} x${quantity} to cart\nStore: ${store.name}\nTotal: $${store.total.toLocaleString("es-CO")}`
            : "Added to cart",
        },
      ],
    };
  }
);

server.tool(
  "remove_from_cart",
  "Remove a product from the shopping cart by its compound ID (e.g. '900006505_3522980')",
  {
    product_id: z
      .string()
      .describe("Compound product ID from get_cart (e.g. '900006505_3522980')"),
    store_type: z.string().optional().default(DEFAULT_STORE_TYPE),
  },
  async ({ product_id, store_type }) => {
    const config = await loadConfig();
    await removeFromCart(store_type, product_id, config);
    const carts = await getCarts(config);
    const remaining = carts.flatMap((c) =>
      c.stores.flatMap((s) => s.products.map((p) => `${p.name} x${p.units}`))
    );
    return {
      content: [
        {
          type: "text",
          text: remaining.length
            ? `Removed. Remaining in cart:\n${remaining.join("\n")}`
            : "Removed. Cart is now empty.",
        },
      ],
    };
  }
);

server.tool(
  "get_cart",
  "View current shopping cart. Returns store_type and store_type_origin for each cart — use store_type when calling checkout/tip/order tools (auto-resolved).",
  {},
  async () => {
    const config = await loadConfig();
    const carts = await getCarts(config);
    if (!carts.length) {
      return { content: [{ type: "text", text: "Cart is empty" }] };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(carts, null, 2) }],
    };
  }
);

server.tool(
  "checkout_preview",
  "Preview the order with full price breakdown. Always call this before place_order and show the summary to the user. store_type auto-resolves (e.g. turbo → restaurant).",
  {
    store_type: z
      .string()
      .optional()
      .default(DEFAULT_STORE_TYPE)
      .describe(
        "Store type from get_cart (auto-resolves turbo → restaurant)"
      ),
  },
  async ({ store_type }) => {
    const config = await loadConfig();
    const resolved = await resolveStoreType(store_type, config);
    const [cart, detail] = await Promise.allSettled([
      recalculateCart(resolved, config),
      getCheckoutDetail(resolved, config),
    ]);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              cart: cart.status === "fulfilled" ? cart.value : null,
              summary: detail.status === "fulfilled" ? detail.value : null,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "set_tip",
  "Set tip amount for the delivery driver. store_type auto-resolves (e.g. turbo → restaurant).",
  {
    amount: z.number().describe("Tip in COP (e.g. 2000) or 0 to remove"),
    store_type: z
      .string()
      .optional()
      .default(DEFAULT_STORE_TYPE)
      .describe(
        "Store type from get_cart (auto-resolves turbo → restaurant)"
      ),
  },
  async ({ amount, store_type }) => {
    const config = await loadConfig();
    const resolved = await resolveStoreType(store_type, config);
    await setTip(resolved, amount, config);
    return {
      content: [
        {
          type: "text",
          text:
            amount > 0
              ? `Tip set to $${amount.toLocaleString("es-CO")}`
              : "Tip removed",
        },
      ],
    };
  }
);

server.tool(
  "place_order",
  "Place the order. ALWAYS call checkout_preview first and get explicit user confirmation before calling this. store_type auto-resolves (e.g. turbo → restaurant).",
  {
    store_type: z
      .string()
      .optional()
      .default(DEFAULT_STORE_TYPE)
      .describe(
        "Store type from get_cart (auto-resolves turbo → restaurant)"
      ),
  },
  async ({ store_type }) => {
    const config = await loadConfig();
    const resolved = await resolveStoreType(store_type, config);
    const result = await placeOrder(resolved, config);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool("track_orders", "Track active and cancelled orders", {}, async () => {
  const config = await loadConfig();
  const data = await getOrders(config);
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[rappi-mcp] server running — 14 tools available");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
