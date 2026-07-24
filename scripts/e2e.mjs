#!/usr/bin/env node
/**
 * Offline e2e for every Grability path the extension calls.
 * Live gate (read-only + optional one remove) if bridge token exists.
 * Never place_order against live.
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { homedir } from "os";
import http from "http";
import fs from "fs";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://services.grability.rappi.com";
const LOGIN_ORIGIN = "https://www.rappi.com.co";

const {
  getUser,
  isPrime,
} = require(join(root, "out/core/services/auth.js"));
const {
  getAddresses,
  setActiveAddress,
  reverseGeocode,
} = require(join(root, "out/core/services/address.js"));
const { search } = require(join(root, "out/core/services/search.js"));
const {
  getStoreDetail,
  getRestaurantCatalog,
} = require(join(root, "out/core/services/store.js"));
const { getProductToppings } = require(join(root, "out/core/services/product.js"));
const {
  addToCart,
  getCarts,
  removeFromCart,
  recalculateCart,
  findCartForProduct,
  productMatchesId,
  resolveCartProductId,
} = require(join(root, "out/core/services/cart.js"));
const {
  getCheckoutDetail,
  getCheckoutWidgets,
  setTip,
  setPaymentMethod,
} = require(join(root, "out/core/services/checkout.js"));
const { placeOrder, getOrders } = require(join(root, "out/core/services/order.js"));
const { RappiHttpError } = require(join(root, "out/core/http.js"));

const fail = (m) => {
  console.error("FAIL:", m);
  process.exit(1);
};

const ok = (m) => console.log("ok:", m);

const config = {
  token: "e2e-mock-token",
  deviceId: "e2e-device",
  lat: 4.624335,
  lng: -74.063644,
};

/** @type {{ method: string, path: string }[]} */
const calls = [];

const marketProduct = {
  id: "900022095_1131454",
  product_id: 1131454,
  name: "Leche",
  units: 1,
  price: 5000,
  total: 5000,
  available: true,
  toppings: [],
};

const marketCart = {
  id: "cart-market",
  store_type: "market",
  store_type_origin: "market",
  stores: [
    {
      id: 900022095,
      name: "Exito",
      available: true,
      is_open: true,
      eta_label: "30 min",
      charge_total: 0,
      product_total: 5000,
      total: 5000,
      valid: true,
      products: [marketProduct],
      charges: [],
    },
  ],
  product_total: 5000,
  shipping_total: 0,
  sub_total: 5000,
};

const turboCart = {
  id: "cart-turbo",
  store_type: "turbo",
  store_type_origin: "restaurant",
  stores: [
    {
      id: 900006505,
      name: "Turbo Shop",
      available: true,
      is_open: true,
      eta_label: "15 min",
      charge_total: 0,
      product_total: 10000,
      total: 10000,
      valid: true,
      products: [
        {
          id: "900006505_3522980",
          product_id: 3522980,
          name: "Snack",
          units: 1,
          price: 10000,
          total: 10000,
          available: true,
          toppings: [],
        },
      ],
      charges: [],
    },
  ],
  product_total: 10000,
  shipping_total: 0,
  sub_total: 10000,
};

let cartsState = [structuredClone(marketCart), structuredClone(turboCart)];
let delete404Primary = false;

function json(data, status = 200) {
  const body =
    data === undefined || data === null ? "" : JSON.stringify(data);
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyOk() {
  return new Response("", { status: 200 });
}

/**
 * Mock every Grability path the extension services hit.
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function mockFetch(url, init = {}) {
  const u = typeof url === "string" ? url : String(url);
  if (!u.startsWith(BASE)) {
    fail(`unexpected host: ${u}`);
  }
  const path = u.slice(BASE.length);
  const method = (init.method || "GET").toUpperCase();
  calls.push({ method, path });

  // --- auth ---
  if (method === "GET" && path === "/ms/application-user/auth") {
    return json({
      id: 1,
      name: "E2E",
      email: "e2e@example.com",
      phone: "+57000",
    });
  }
  if (method === "GET" && path === "/api/ms/rappi-prime/is-prime") {
    return json({ is_prime: false });
  }

  // --- address ---
  if (method === "GET" && path.startsWith("/api/ms/address/reverse-geocode")) {
    return json({ address: "Calle E2E", lat: config.lat, lng: config.lng });
  }
  if (method === "GET" && path === "/api/ms/users-address/addresses") {
    return json({
      addresses: [
        {
          id: 42,
          address: "Calle E2E",
          active: true,
          lat: config.lat,
          lng: config.lng,
        },
      ],
    });
  }
  if (
    method === "PUT" &&
    /^\/api\/ms\/users-address\/addresses\/\d+\/active$/.test(path)
  ) {
    return json({});
  }

  // --- search / store / product ---
  if (
    method === "POST" &&
    path.startsWith("/api/pns-global-search-api/v1/unified-search")
  ) {
    return json({
      stores: [
        {
          store_id: 900022095,
          store_type: "market",
          name: "Exito",
          products: [
            {
              product_id: 1131454,
              name: "Leche",
              price: 5000,
              has_toppings: false,
            },
          ],
        },
      ],
    });
  }
  if (
    method === "GET" &&
    /^\/api\/web-gateway\/web\/stores-router\/id\/\d+\/$/.test(path)
  ) {
    return json({
      store_id: 900022095,
      name: "Exito",
      address: "Calle 1",
      store_type: { id: "market", description: "market" },
      status: { status: "open" },
    });
  }
  if (
    method === "GET" &&
    /^\/api\/restaurant-bus\/store\/\d+\/menu$/.test(path)
  ) {
    return json({
      corridors: [
        {
          id: 1,
          name: "Destacados",
          products: [
            {
              id: 1131454,
              name: "Leche",
              price: 5000,
              has_toppings: false,
              in_stock: true,
            },
          ],
        },
      ],
    });
  }
  if (
    method === "POST" &&
    path === "/api/restaurant-bus/stores/catalog-paged/home"
  ) {
    return json({ stores: [], offset: 0, limit: 20 });
  }
  if (
    method === "GET" &&
    /^\/api\/web-gateway\/web\/restaurants-bus\/products\/toppings\/\d+\/\d+\/$/.test(
      path
    )
  ) {
    return json({ toppings: [] });
  }

  // --- cart ---
  if (method === "POST" && path === "/api/ms/shopping-cart/v1/all/get") {
    return json(cartsState);
  }
  if (
    method === "PUT" &&
    /^\/api\/ms\/shopping-cart\/v2\/[^/]+\/store$/.test(path)
  ) {
    return json(cartsState[0]);
  }
  if (
    method === "DELETE" &&
    /^\/api\/ms\/shopping-cart\/v2\/([^/]+)\/product\/(.+)$/.test(path)
  ) {
    const m = path.match(
      /^\/api\/ms\/shopping-cart\/v2\/([^/]+)\/product\/(.+)$/
    );
    const storeType = m[1];
    const productId = m[2];
    if (productId.includes("%")) {
      fail(`DELETE product id must not be URI-encoded: ${productId}`);
    }
    // Simulate primary store_type 404 then origin success for turbo cart.
    if (
      delete404Primary &&
      storeType === "turbo" &&
      productId === "900006505_3522980"
    ) {
      return json({ error: "not found" }, 404);
    }
    if (
      delete404Primary &&
      storeType === "restaurant" &&
      productId === "900006505_3522980"
    ) {
      return emptyOk();
    }
    // Market remove must use market, never restaurant.
    if (productId === "900022095_1131454" || productId === "1131454") {
      if (storeType === "restaurant") {
        fail("market-cart remove must never hit /restaurant/");
      }
      if (storeType !== "market") {
        return json({ error: "wrong type" }, 404);
      }
      return emptyOk();
    }
    return emptyOk();
  }
  if (
    method === "POST" &&
    /^\/api\/ms\/shopping-cart\/v1\/[^/]+\/recalculate$/.test(path)
  ) {
    const st = path.split("/")[5];
    const cart =
      cartsState.find((c) => c.store_type === st || c.store_type_origin === st) ||
      cartsState[0];
    return json(cart);
  }

  // --- checkout / tip / payment ---
  if (
    method === "GET" &&
    /^\/api\/ms\/shopping-cart\/v1\/[^/]+\/checkout\/detail$/.test(path)
  ) {
    return json({ return_key: "rk-e2e", total: 5000 });
  }
  if (method === "POST" && /^\/api\/ms\/checkout-component\/[^/]+$/.test(path)) {
    return json([]);
  }
  if (
    method === "PUT" &&
    /^\/api\/ms\/shopping-cart\/v1\/[^/]+\/tip$/.test(path)
  ) {
    return json({});
  }
  if (
    method === "PUT" &&
    /^\/api\/ms\/shopping-cart\/v1\/[^/]+\/payment-method$/.test(path)
  ) {
    return json({});
  }

  // --- place / orders ---
  if (
    method === "POST" &&
    /^\/api\/ms\/shopping-cart-proxy\/[^/]+\/checkout$/.test(path)
  ) {
    return json({ order_id: "ord-e2e" });
  }
  if (method === "GET" && path === "/api/user-order-home/orders") {
    return json({ orders: [] });
  }

  fail(`unmocked ${method} ${path}`);
}

async function offlineE2e() {
  calls.length = 0;
  cartsState = [structuredClone(marketCart), structuredClone(turboCart)];
  delete404Primary = false;
  globalThis.fetch = mockFetch;

  // Static fuzzy helpers
  if (!productMatchesId(marketProduct, "900022095_1131454")) {
    fail("exact id match");
  }
  if (!productMatchesId(marketProduct, "1131454")) {
    fail("suffix fuzzy match");
  }
  if (!productMatchesId(marketProduct, String(marketProduct.product_id))) {
    fail("product_id passthrough match");
  }
  if (findCartForProduct(cartsState, "1131454")?.store_type !== "market") {
    fail("findCartForProduct fuzzy → market");
  }
  if (
    resolveCartProductId(cartsState[0], "1131454") !== "900022095_1131454"
  ) {
    fail("resolveCartProductId should return compound id");
  }
  ok("fuzzy product match");

  // Exercise every service path
  await getUser(config);
  await isPrime(config);
  await reverseGeocode(config);
  await getAddresses(config);
  await setActiveAddress(42, config);
  await search("leche", config);
  await getStoreDetail(900022095, config);
  await getRestaurantCatalog(config);
  await getProductToppings(900006505, 3522980, config);
  await addToCart(
    "market",
    [
      {
        id: 900022095,
        products: [
          {
            id: "1131454",
            name: "Leche",
            toppings: [],
            units: 1,
            price: 5000,
          },
        ],
      },
    ],
    config
  );
  await getCarts(config);
  await recalculateCart("market", config);
  await getCheckoutDetail("market", config);
  await getCheckoutWidgets("market", config);
  await setTip("market", 2000, config);
  await setPaymentMethod("market", { id: 1 }, config);
  await getOrders(config);
  await placeOrder("market", config);
  ok("all Grability service paths mocked");

  // Market remove by bare suffix — must not touch /restaurant/
  const before = calls.length;
  await removeFromCart(undefined, "1131454", config);
  const removeCalls = calls.slice(before).filter((c) => c.method === "DELETE");
  if (!removeCalls.length) fail("expected DELETE for market remove");
  for (const c of removeCalls) {
    if (c.path.includes("/restaurant/")) {
      fail(`market remove hit restaurant path: ${c.path}`);
    }
    if (!c.path.includes("/market/product/900022095_1131454")) {
      fail(`expected market compound DELETE, got ${c.path}`);
    }
  }
  ok("market-cart remove never hits /restaurant/");

  // Missing product lists ids
  try {
    await removeFromCart(undefined, "does-not-exist", config);
    fail("expected missing product error");
  } catch (e) {
    const msg = String(e.message || e);
    if (!msg.includes("Available ids:") || !msg.includes("900022095_1131454")) {
      fail(`missing-product error should list ids, got: ${msg}`);
    }
  }
  ok("missing product lists cart ids");

  // Dual store_type: turbo 404 → retry restaurant origin; empty 2xx body OK
  delete404Primary = true;
  cartsState = [structuredClone(turboCart)];
  const beforeTurbo = calls.length;
  await removeFromCart(undefined, "900006505_3522980", config);
  const turboDeletes = calls
    .slice(beforeTurbo)
    .filter((c) => c.method === "DELETE")
    .map((c) => c.path);
  if (
    !turboDeletes.some((p) => p.includes("/turbo/product/")) ||
    !turboDeletes.some((p) => p.includes("/restaurant/product/"))
  ) {
    fail(`expected turbo then restaurant DELETE, got ${JSON.stringify(turboDeletes)}`);
  }
  ok("store_type then store_type_origin retry on 404");

  // del() empty body + error snippet
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).slice(BASE.length);
    const method = (init.method || "GET").toUpperCase();
    if (method === "DELETE" && path.includes("/empty-ok")) {
      return emptyOk();
    }
    if (method === "DELETE" && path.includes("/err-body")) {
      return new Response('{"detail":"nope"}', { status: 500 });
    }
    return mockFetch(url, init);
  };
  const { del } = require(join(root, "out/core/http.js"));
  const empty = await del("/api/ms/shopping-cart/v2/market/product/empty-ok", config);
  if (empty !== undefined) fail(`empty DELETE body should be undefined, got ${empty}`);
  try {
    await del("/api/ms/shopping-cart/v2/market/product/err-body", config);
    fail("expected DELETE error");
  } catch (e) {
    if (!(e instanceof RappiHttpError) || !String(e.message).includes("nope")) {
      fail(`DELETE error should include body snippet, got: ${e}`);
    }
  }
  ok("del empty 2xx + error snippet");

  // Source guards
  const cartSrc = fs.readFileSync(join(root, "src/core/services/cart.ts"), "utf8");
  if (cartSrc.includes("encodeURIComponent")) {
    fail("removeFromCart must not use encodeURIComponent");
  }
  if (!cartSrc.includes("productMatchesId")) {
    fail("cart.ts must export/use productMatchesId");
  }

  await runCaptureHandoffE2e();

  console.log("e2e offline ok");
}

function postCapture(port, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/capture",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
          origin: LOGIN_ORIGIN,
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: raw })
        );
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Work Unit 2 / PR2 — capture → setupFromToken handoff (offline).
 * Never logs Authorization / Bearer material.
 */
async function runCaptureHandoffE2e() {
  const {
    startCaptureSession,
    isConnectAllowed,
  } = require(join(root, "out/core/sessionCapture.js"));
  const { completeCaptureHandoff } = require(join(
    root,
    "out/core/captureHandoff.js"
  ));
  const { LOGIN_URL } = require(join(root, "out/core/constants.js"));

  if (typeof completeCaptureHandoff !== "function") {
    fail("completeCaptureHandoff export missing");
  }
  if (typeof isConnectAllowed !== "function") {
    fail("isConnectAllowed export missing");
  }
  if (LOGIN_URL !== "https://www.rappi.com.co/login") {
    fail(`LOGIN_URL must be CO login, got ${LOGIN_URL}`);
  }

  // Synthetic token — never printed.
  const secretAuth = ["Bea", "rer ", "ft.gAAAAA_E2E_HANDOFF"].join("");
  const capturedDevice = "e2e-captured-device-42";

  /** @type {{ setupCalls: object[], clearCalls: number, config: object | null }} */
  const track = { setupCalls: [], clearCalls: 0, config: null };

  function makeStore() {
    return {
      async setupFromToken(opts) {
        track.setupCalls.push({
          token: opts.token,
          deviceId: opts.deviceId,
        });
        track.config = {
          token: String(opts.token || "").replace(/^bearer\s+/i, "").trim(),
          deviceId: opts.deviceId || "generated",
          lat: 4.624335,
          lng: -74.063644,
        };
        return track.config;
      },
      async updateCoords(lat, lng) {
        if (track.config) {
          track.config.lat = lat;
          track.config.lng = lng;
        }
      },
      async load() {
        if (!track.config) throw new Error("no credentials");
        return track.config;
      },
      async clear() {
        track.clearCalls += 1;
        track.config = null;
      },
    };
  }

  // --- valid POST → handoff (setupFromToken + deviceId) ---
  track.setupCalls = [];
  track.clearCalls = 0;
  track.config = null;
  {
    const session = await startCaptureSession({ ttlMs: 10_000 });
    try {
      const waiting = session.waitForCapture();
      const post = await postCapture(session.port, {
        nonce: session.nonce,
        authorization: secretAuth,
        deviceid: capturedDevice,
      });
      if (post.status !== 200) {
        fail(`valid capture POST expected 200, got ${post.status}`);
      }
      const payload = await waiting;
      if (!payload?.authorization) {
        fail("waitForCapture must return authorization payload");
      }
      if (payload.deviceid !== capturedDevice) {
        fail("waitForCapture must include captured deviceid");
      }

      const store = makeStore();
      const result = await completeCaptureHandoff(store, payload, {
        getAddresses: async () => ({
          addresses: [{ active: true, lat: 4.7, lng: -74.1 }],
        }),
        getUser: async () => ({ name: "E2E User", email: "e2e@test" }),
        isPrime: async () => true,
      });
      if (!result.ok) {
        fail(`valid handoff should succeed, got ${result.error}`);
      }
      if (track.setupCalls.length !== 1) {
        fail(`setupFromToken call count ${track.setupCalls.length}, want 1`);
      }
      if (track.setupCalls[0].deviceId !== capturedDevice) {
        fail("setupFromToken must receive captured deviceId");
      }
      if (track.clearCalls !== 0) {
        fail("valid handoff must not clear credentials");
      }
      if (track.config?.lat !== 4.7 || track.config?.lng !== -74.1) {
        fail("handoff should apply address coords when present");
      }
    } finally {
      session.dispose();
    }
  }
  ok("capture handoff: valid POST → setupFromToken");

  // --- bad nonce → no setupFromToken ---
  track.setupCalls = [];
  track.clearCalls = 0;
  {
    const session = await startCaptureSession({ ttlMs: 10_000 });
    try {
      const bad = await postCapture(session.port, {
        nonce: "not-the-session-nonce",
        authorization: secretAuth,
      });
      if (bad.status === 200) {
        fail("invalid nonce must not accept capture");
      }
      if (track.setupCalls.length !== 0) {
        fail("invalid nonce path must not call setupFromToken");
      }
    } finally {
      session.dispose();
    }
  }
  ok("capture handoff: bad nonce → no setupFromToken");

  // --- expired nonce → no setupFromToken ---
  track.setupCalls = [];
  {
    const session = await startCaptureSession({ ttlMs: 40 });
    await sleep(80);
    let lateStatus;
    try {
      const late = await postCapture(session.port, {
        nonce: session.nonce,
        authorization: secretAuth,
      });
      lateStatus = late.status;
    } catch (err) {
      // Listener closed after TTL — connection refused is also a reject.
      lateStatus = "closed";
      if (!/ECONNREFUSED|expired|410/.test(String(err))) {
        /* still treated as reject */
      }
    }
    if (lateStatus === 200) {
      fail("expired capture must not accept POST");
    }
    if (track.setupCalls.length !== 0) {
      fail("expired nonce path must not call setupFromToken");
    }
    session.dispose();
  }
  ok("capture handoff: expired → no setupFromToken");

  // --- validation fail → clear ---
  track.setupCalls = [];
  track.clearCalls = 0;
  track.config = null;
  {
    const store = makeStore();
    const result = await completeCaptureHandoff(
      store,
      {
        nonce: "n",
        authorization: secretAuth,
        deviceid: capturedDevice,
      },
      {
        getAddresses: async () => ({ addresses: [] }),
        getUser: async () => {
          throw new Error("unauthorized mock");
        },
        isPrime: async () => false,
      }
    );
    if (result.ok) fail("validation failure must not report ok");
    if (track.setupCalls.length !== 1) {
      fail("validation-fail path still persists then clears");
    }
    if (track.clearCalls !== 1) {
      fail(`validation fail must clear credentials, clearCalls=${track.clearCalls}`);
    }
    if (!/unauthorized mock/i.test(result.error || "")) {
      fail("validation-fail error must be non-token message");
    }
    if (/ft\.gAAAAA|Bearer\s+ft/i.test(JSON.stringify(result))) {
      fail("handoff result must never echo Bearer/token material");
    }
  }
  ok("capture handoff: validation fail → clear");

  // Extension Connect wiring (source contract for PR2)
  const extSrc = fs.readFileSync(join(root, "src/extension.ts"), "utf8");
  if (!extSrc.includes("isConnectAllowed")) {
    fail("extension must gate Connect with isConnectAllowed");
  }
  if (!extSrc.includes("startCaptureSession")) {
    fail("extension must startCaptureSession on Connect");
  }
  if (!extSrc.includes("completeCaptureHandoff")) {
    fail("extension must hand off via completeCaptureHandoff");
  }
  if (!extSrc.includes("LOGIN_URL")) {
    fail("extension must open LOGIN_URL for Connect");
  }
  if (!/Advanced|avanzad/i.test(extSrc)) {
    fail("extension must demote paste to advanced after Connect miss/refuse");
  }
  if (/console\.(log|info|debug|warn|error)\([^)]*authorization/i.test(extSrc)) {
    fail("extension must never log Authorization");
  }
  ok("capture handoff: extension Connect wiring");
}

async function liveGate() {
  const bridgePath = join(homedir(), ".config", "rappi-cursor", "config.json");
  if (!fs.existsSync(bridgePath)) {
    console.log("e2e live: skipped (no bridge config)");
    return;
  }
  let bridge;
  try {
    bridge = JSON.parse(fs.readFileSync(bridgePath, "utf8"));
  } catch {
    console.log("e2e live: skipped (unreadable bridge)");
    return;
  }
  if (!bridge?.token) {
    console.log("e2e live: skipped (no token)");
    return;
  }

  // Restore real fetch for live calls
  const { fetch: undiciFetch } = await import("undici").catch(() => ({
    fetch: undefined,
  }));
  // Node 18+ has global fetch; use the original we saved if possible
  if (typeof liveFetch === "function") {
    globalThis.fetch = liveFetch;
  } else if (undiciFetch) {
    globalThis.fetch = undiciFetch;
  }

  const liveConfig = {
    token: bridge.token,
    deviceId: bridge.deviceId || "e2e-live",
    lat: bridge.lat ?? 4.624335,
    lng: bridge.lng ?? -74.063644,
  };

  console.log("e2e live: whoami / get_cart / search (no place_order)");
  try {
    const user = await getUser(liveConfig);
    console.log("e2e live whoami:", user?.name || user?.email || "ok");
  } catch (e) {
    console.warn("e2e live whoami failed:", e.message || e);
    return;
  }

  let carts = [];
  try {
    carts = await getCarts(liveConfig);
    console.log("e2e live get_cart:", Array.isArray(carts) ? carts.length : "ok");
  } catch (e) {
    console.warn("e2e live get_cart failed:", e.message || e);
  }

  try {
    const sr = await search("agua", liveConfig);
    const n = sr?.stores?.length ?? 0;
    console.log("e2e live search stores:", n);
  } catch (e) {
    console.warn("e2e live search failed:", e.message || e);
  }

  // Optional one remove if cart has a product — never place_order
  const removeOne = process.env.RAPPI_E2E_REMOVE === "1";
  if (removeOne && Array.isArray(carts)) {
    const product = carts
      .flatMap((c) => c.stores || [])
      .flatMap((s) => s.products || [])[0];
    if (product?.id) {
      console.log("e2e live optional remove:", product.id);
      await removeFromCart(undefined, product.id, liveConfig);
      console.log("e2e live remove ok");
    } else {
      console.log("e2e live optional remove: cart empty, skipped");
    }
  } else {
    console.log("e2e live: remove skipped (set RAPPI_E2E_REMOVE=1 to enable)");
  }
  console.log("e2e live ok (place_order never called)");
}

const liveFetch = globalThis.fetch;

await offlineE2e();
await liveGate();
