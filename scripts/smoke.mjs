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
const {
  DEFAULT_STORE_TYPE,
  BASE_URL,
  LOGIN_URL,
  LOGIN_ORIGIN,
  GRABILITY_HOST,
  CAPTURE_TTL_MS,
  CAPTURE_ALLOWED_ORIGINS,
} = require(join(root, "out/core/constants.js"));
const { RappiHttpError } = require(join(root, "out/core/http.js"));
const {
  addToCart,
  findCartForProduct,
  apiStoreType,
  productMatchesId,
} = require(join(root, "out/core/services/cart.js"));
const { coordsFromBridge } = require(join(root, "out/core/config.js"));
const fs = require("fs");
const http = require("http");

const fail = (m) => {
  console.error("FAIL:", m);
  process.exit(1);
};

if (formatPrice(28500) !== "$28.500") fail(`formatPrice got ${formatPrice(28500)}`);
if (!imageUrl("x.png").includes("images.rappi.com")) fail("imageUrl");
if (DEFAULT_STORE_TYPE !== "restaurant") fail("store type");
if (!BASE_URL.includes("grability.rappi.com")) fail("base url");
if (LOGIN_URL !== "https://www.rappi.com.co/login") {
  fail(`LOGIN_URL must be CO login, got ${LOGIN_URL}`);
}
if (LOGIN_ORIGIN !== "https://www.rappi.com.co") {
  fail(`LOGIN_ORIGIN must be www CO origin, got ${LOGIN_ORIGIN}`);
}
if (GRABILITY_HOST !== "services.grability.rappi.com") {
  fail(`GRABILITY_HOST mismatch: ${GRABILITY_HOST}`);
}
if (CAPTURE_TTL_MS !== 120_000) {
  fail(`CAPTURE_TTL_MS must be 120s, got ${CAPTURE_TTL_MS}`);
}
if (
  !Array.isArray(CAPTURE_ALLOWED_ORIGINS) ||
  !CAPTURE_ALLOWED_ORIGINS.includes("https://www.rappi.com.co")
) {
  fail("CAPTURE_ALLOWED_ORIGINS must include www.rappi.com.co");
}

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

// remove_from_cart must resolve cart by product id (not hardcode restaurant)
const fakeCarts = [
  {
    store_type: "market",
    store_type_origin: "market",
    stores: [
      {
        products: [{ id: "900022095_1131454", product_id: 1131454, name: "x" }],
      },
    ],
  },
];
const found = findCartForProduct(fakeCarts, "900022095_1131454");
if (!found || apiStoreType(found) !== "market") {
  fail("findCartForProduct/apiStoreType must pick market cart for product");
}
if (findCartForProduct(fakeCarts, "missing")) {
  fail("findCartForProduct should miss unknown ids");
}
if (!productMatchesId(fakeCarts[0].stores[0].products[0], "1131454")) {
  fail("productMatchesId must match bare product suffix");
}
if (!findCartForProduct(fakeCarts, "1131454")) {
  fail("findCartForProduct must fuzzy-match bare product id");
}

const cartSrc = fs.readFileSync(join(root, "src/core/services/cart.ts"), "utf8");
if (!cartSrc.includes("findCartForProduct")) {
  fail("removeFromCart must look up product cart");
}
if (cartSrc.includes("encodeURIComponent")) {
  fail("removeFromCart must not encodeURIComponent the product id");
}
if (!cartSrc.includes("store_type_origin")) {
  fail("removeFromCart must retry store_type_origin on 404");
}
const httpSrc = fs.readFileSync(join(root, "src/core/http.ts"), "utf8");
if (!httpSrc.includes("!text.trim()")) {
  fail("del() must tolerate empty 2xx bodies");
}
const orderSrc = fs.readFileSync(join(root, "src/core/services/order.ts"), "utf8");
if (!orderSrc.includes("assertCartPlaceable")) {
  fail("placeOrder must gate on store.valid");
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

// --- session-capture (Work Unit 1 / PR1) ---
const {
  startCaptureSession,
  isConnectAllowed,
} = require(join(root, "out/core/sessionCapture.js"));

if (typeof isConnectAllowed !== "function") fail("isConnectAllowed export missing");
if (isConnectAllowed(undefined) !== true) fail("local host must allow Connect");
if (isConnectAllowed(null) !== true) fail("null remoteName must allow Connect");
if (isConnectAllowed("ssh-remote") !== false) {
  fail("remote SSH host must refuse Connect");
}

function postJson(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
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
          resolve({ status: res.statusCode, headers: res.headers, body: raw })
        );
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function getText(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${path}`, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: raw })
        );
      })
      .on("error", reject);
  });
}

async function runCaptureSmoke() {
  if (typeof startCaptureSession !== "function") {
    fail("startCaptureSession export missing");
  }

  // Synthetic token for offline capture — never logged.
  const secret = ["Bea", "rer ", "ft.gAAAAA_SMOKE_TOKEN"].join("");

  const session = await startCaptureSession({ ttlMs: CAPTURE_TTL_MS });
  try {
    if (!session.nonce || typeof session.nonce !== "string") {
      fail("capture session must expose a nonce");
    }
    if (!Number.isInteger(session.port) || session.port <= 0) {
      fail(`capture session port invalid: ${session.port}`);
    }
    if (!session.installUrl.startsWith(`http://127.0.0.1:${session.port}/`)) {
      fail(`installUrl must be loopback, got ${session.installUrl}`);
    }
    if (/bearer|authorization|ft\.gAAAA/i.test(session.installUrl)) {
      fail("installUrl must never contain Bearer/token material");
    }

    const install = await getText(session.port, new URL(session.installUrl).pathname);
    if (install.status !== 200) fail(`GET /install status ${install.status}`);
    if (!/Connect Cursor|Connect/i.test(install.body)) {
      fail("install page must use Connect product copy");
    }
    if (/bookmarklet/i.test(install.body)) {
      fail("install page must not frame as bookmarklet");
    }
    if (!install.body.includes(session.nonce)) {
      fail("install page must embed session nonce for capturer");
    }
    if (!install.body.includes("/capture")) {
      fail("install/capturer must POST to /capture");
    }
    if (!install.body.includes(GRABILITY_HOST)) {
      fail("capturer must target Grability host");
    }
    if (/authorization=[^"'&\s]+/i.test(install.body)) {
      fail("install HTML must not put tokens in URI query form");
    }

    const wait = session.waitForCapture();
    const ok = await postJson(session.port, "/capture", {
      nonce: session.nonce,
      authorization: secret,
      deviceid: "device-smoke-1",
    });
    if (ok.status !== 200) fail(`valid capture POST status ${ok.status}`);
    const payload = await wait;
    if (payload.authorization !== secret) {
      fail("waitForCapture must return authorization");
    }
    if (payload.deviceid !== "device-smoke-1") {
      fail("waitForCapture must return deviceid when present");
    }
    if (payload.nonce !== session.nonce) {
      fail("waitForCapture payload nonce mismatch");
    }

    // reused nonce must be rejected (single-use)
    const reused = await postJson(session.port, "/capture", {
      nonce: session.nonce,
      authorization: secret,
    });
    if (reused.status < 400) {
      fail(`reused nonce must be rejected, got ${reused.status}`);
    }
  } finally {
    session.dispose();
  }

  // invalid nonce rejected on a fresh session
  const session2 = await startCaptureSession({ ttlMs: 5_000 });
  try {
    const bad = await postJson(session2.port, "/capture", {
      nonce: "wrong-nonce",
      authorization: secret,
    });
    if (bad.status < 400) fail(`invalid nonce must be rejected, got ${bad.status}`);

    // CORS: disallowed origin must not get CO allow
    const cors = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: session2.port,
          path: "/capture",
          method: "OPTIONS",
          headers: {
            origin: "https://evil.example",
            "access-control-request-method": "POST",
          },
        },
        (res) => {
          resolve({
            status: res.statusCode,
            acao: res.headers["access-control-allow-origin"],
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
    if (cors.acao === "https://evil.example" || cors.acao === "*") {
      fail("CORS must not allow non-Rappi CO origins");
    }

    const allowedPreflight = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: session2.port,
          path: "/capture",
          method: "OPTIONS",
          headers: {
            origin: LOGIN_ORIGIN,
            "access-control-request-method": "POST",
          },
        },
        (res) => {
          resolve({
            status: res.statusCode,
            acao: res.headers["access-control-allow-origin"],
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
    if (allowedPreflight.acao !== LOGIN_ORIGIN) {
      fail(`CORS must allow ${LOGIN_ORIGIN}, got ${allowedPreflight.acao}`);
    }
  } finally {
    session2.dispose();
  }

  // TTL reject: short TTL, wait past expiry, late POST rejected (4xx or closed)
  const short = await startCaptureSession({ ttlMs: 40 });
  try {
    await new Promise((r) => setTimeout(r, 80));
    let lateStatus = 0;
    try {
      const late = await postJson(short.port, "/capture", {
        nonce: short.nonce,
        authorization: secret,
      });
      lateStatus = late.status;
    } catch (err) {
      // Listener disposed after expiry — payload cannot be accepted.
      if (err && (err.code === "ECONNREFUSED" || err.code === "ECONNRESET")) {
        lateStatus = 410;
      } else {
        throw err;
      }
    }
    if (lateStatus < 400) {
      fail(`expired TTL must reject late POST, got ${lateStatus}`);
    }
  } finally {
    short.dispose();
  }
}

await runCaptureSmoke();

console.log("smoke ok:", {
  tools: tools.length,
  publisher: pkg.publisher,
  version: pkg.version,
  coordsFromBridge: "ok",
  removeLookup: "ok",
  sessionCapture: "ok",
});
