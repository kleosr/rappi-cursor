#!/usr/bin/env node
/**
 * Offline smoke checks — no live Rappi token required.
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const { formatPrice, imageUrl } = require(join(root, "out/core/formatters.js"));
const { DEFAULT_STORE_TYPE, BASE_URL } = require(join(root, "out/core/constants.js"));
const { RappiHttpError } = require(join(root, "out/core/http.js"));
const { addToCart } = require(join(root, "out/core/services/cart.js"));
const { coordsFromBridge } = require(join(root, "out/core/config.js"));
const fs = require("fs");

const fail = (m) => {
  console.error("FAIL:", m);
  process.exit(1);
};

if (formatPrice(28500) !== "$28.500") fail(`formatPrice got ${formatPrice(28500)}`);
if (!imageUrl("x.png").includes("images.rappi.com")) fail("imageUrl");
if (DEFAULT_STORE_TYPE !== "restaurant") fail("store type");
if (!BASE_URL.includes("grability.rappi.com")) fail("base url");

const err = new RappiHttpError("x", 401, "/t");
if (!err.isAuthError) fail("RappiHttpError.isAuthError");

// MCP set_address writes bridge coords; sidebar load must prefer them over globalState defaults
const fallback = { lat: 4.624335, lng: -74.063644 };
const bridge = { lat: 6.2442, lng: -75.5812 };
const merged = coordsFromBridge(fallback, bridge);
if (merged.lat !== bridge.lat || merged.lng !== bridge.lng) {
  fail(`coordsFromBridge should prefer bridge, got ${JSON.stringify(merged)}`);
}
const noDisk = coordsFromBridge(fallback, null);
if (noDisk.lat !== fallback.lat || noDisk.lng !== fallback.lng) {
  fail("coordsFromBridge should keep fallback when bridge missing");
}

const mcpSrc = fs.readFileSync(join(root, "src/mcp/server.ts"), "utf8");
if (!mcpSrc.includes("saveConfigToDisk(config)")) {
  fail("MCP set_address must still write bridge coords");
}
const storeSrc = fs.readFileSync(join(root, "src/core/configStore.ts"), "utf8");
if (!storeSrc.includes("coordsFromBridge")) {
  fail("ConfigStore.load must merge bridge coords via coordsFromBridge");
}

const tools = [...mcpSrc.matchAll(/server\.tool\(\s*"([^"]+)"/g)].map((m) => m[1]);
const expected = [
  "whoami",
  "list_addresses",
  "set_address",
  "search",
  "list_restaurants",
  "get_store",
  "get_product_options",
  "add_to_cart",
  "remove_from_cart",
  "get_cart",
  "checkout_preview",
  "set_tip",
  "place_order",
  "track_orders",
];
if (tools.length !== 14) fail(`tool count ${tools.length}`);
for (const t of expected) {
  if (!tools.includes(t)) fail(`missing tool ${t}`);
}

if (typeof addToCart !== "function") fail("addToCart");

const pkg = JSON.parse(fs.readFileSync(join(root, "package.json"), "utf8"));
if (pkg.publisher !== "kleosr") fail("publisher must be kleosr");
if (!pkg.license) fail("license missing");

console.log("smoke ok:", {
  tools: tools.length,
  publisher: pkg.publisher,
  version: pkg.version,
  coordsFromBridge: "ok",
});
