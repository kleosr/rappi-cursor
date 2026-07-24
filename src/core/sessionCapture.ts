/**
 * Ephemeral 127.0.0.1 loopback capture for Connect auth.
 * Capturer POSTs Grability Authorization (+ deviceid) with a one-time nonce.
 * Never log Bearer tokens.
 */

import * as crypto from "crypto";
import * as http from "http";
import {
  CAPTURE_ALLOWED_ORIGINS,
  CAPTURE_TTL_MS,
  GRABILITY_HOST,
} from "./constants";

export type CapturePayload = {
  nonce: string;
  authorization: string;
  deviceid?: string;
};

export type CaptureSession = {
  port: number;
  nonce: string;
  installUrl: string;
  waitForCapture(signal?: AbortSignal): Promise<CapturePayload>;
  dispose(): void;
};

export type StartCaptureSessionOptions = {
  /** Override TTL for tests; production default is CAPTURE_TTL_MS (120s). */
  ttlMs?: number;
};

/** Connect is local-host only — refuse when VS Code remoteName is set. */
export function isConnectAllowed(
  remoteName: string | undefined | null
): boolean {
  return !remoteName;
}

function isAllowedOrigin(origin: string | undefined): origin is string {
  if (!origin) return false;
  return (CAPTURE_ALLOWED_ORIGINS as readonly string[]).includes(origin);
}

function readJsonBody(
  req: http.IncomingMessage
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function setCors(
  res: http.ServerResponse,
  origin: string | undefined
): void {
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
  }
}

function buildInstallHtml(port: number, nonce: string): string {
  const captureUrl = `http://127.0.0.1:${port}/capture`;
  // Productized Connect helper — runs in page context after user activates it.
  const capturerJs = [
    "(function(){",
    `var CAPTURE_URL=${JSON.stringify(captureUrl)};`,
    `var NONCE=${JSON.stringify(nonce)};`,
    `var HOST=${JSON.stringify(GRABILITY_HOST)};`,
    "function pickDeviceId(h){",
    "  if(!h)return;",
    "  var k=Object.keys(h).find(function(x){return x.toLowerCase()==='deviceid';});",
    "  return k?h[k]:undefined;",
    "}",
    "function send(auth,deviceid){",
    "  if(window.__rappiCursorCaptured)return;",
    "  window.__rappiCursorCaptured=true;",
    "  var body={nonce:NONCE,authorization:auth};",
    "  if(deviceid)body.deviceid=String(deviceid);",
    "  fetch(CAPTURE_URL,{method:'POST',mode:'cors',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).catch(function(){});",
    "}",
    "function fromHeaders(h){",
    "  if(!h)return;",
    "  var auth=h.Authorization||h.authorization;",
    "  if(auth&&/Bearer\\s+\\S+/i.test(String(auth)))send(String(auth),pickDeviceId(h));",
    "}",
    "var of=window.fetch;",
    "window.fetch=function(input,init){",
    "  try{",
    "    var url=typeof input==='string'?input:(input&&input.url)||'';",
    "    if(url.indexOf(HOST)!==-1){",
    "      var h=(init&&init.headers)||(input&&input.headers);",
    "      if(h&&typeof h.forEach==='function'){var o={};h.forEach(function(v,k){o[k]=v;});fromHeaders(o);}",
    "      else fromHeaders(h);",
    "    }",
    "  }catch(e){}",
    "  return of.apply(this,arguments);",
    "};",
    "var XO=XMLHttpRequest.prototype.open;",
    "var XS=XMLHttpRequest.prototype.setRequestHeader;",
    "var XSend=XMLHttpRequest.prototype.send;",
    "XMLHttpRequest.prototype.open=function(m,u){",
    "  this.__rappiUrl=u;",
    "  this.__rappiHeaders={};",
    "  return XO.apply(this,arguments);",
    "};",
    "XMLHttpRequest.prototype.setRequestHeader=function(k,v){",
    "  this.__rappiHeaders=this.__rappiHeaders||{};",
    "  this.__rappiHeaders[k]=v;",
    "  return XS.apply(this,arguments);",
    "};",
    "XMLHttpRequest.prototype.send=function(){",
    "  try{",
    "    if(this.__rappiUrl&&String(this.__rappiUrl).indexOf(HOST)!==-1)fromHeaders(this.__rappiHeaders);",
    "  }catch(e){}",
    "  return XSend.apply(this,arguments);",
    "};",
    "alert('Connect Cursor ready. Refresh this page or continue browsing Rappi to finish.');",
    "})();",
  ].join("");

  const connectHref = `javascript:${encodeURIComponent(capturerJs)}`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect Cursor · Rappi</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;line-height:1.45;color:#1a1a1a}
    h1{font-size:1.35rem;margin:0 0 .5rem}
    .hint{color:#555;font-size:.95rem}
    a.cta{display:inline-block;margin-top:1rem;padding:.75rem 1.1rem;background:#FF441F;color:#fff;text-decoration:none;border-radius:8px;font-weight:600}
    ol{padding-left:1.2rem}
    code{font-size:.85em;background:#f4f4f4;padding:.1em .3em;border-radius:4px}
  </style>
</head>
<body>
  <h1>Connect Cursor</h1>
  <p class="hint">Link your Rappi session to Cursor without DevTools. Stay on <code>rappi.com.co</code>.</p>
  <ol>
    <li>Log in on Rappi if you have not already.</li>
    <li>Drag or open this Connect action, then refresh the Rappi tab.</li>
    <li>Return to Cursor — capture closes automatically.</li>
  </ol>
  <p><a class="cta" href="${connectHref}">Connect Cursor</a></p>
  <p class="hint">Session nonce embedded for <code>/capture</code> handoff. Token never appears in this URL query.</p>
  <!-- nonce:${nonce} -->
</body>
</html>`;
}

export async function startCaptureSession(
  options?: StartCaptureSessionOptions
): Promise<CaptureSession> {
  const ttlMs = options?.ttlMs ?? CAPTURE_TTL_MS;
  const nonce = crypto.randomBytes(16).toString("hex");
  let consumed = false;
  let expired = false;
  let disposed = false;
  let resolved: CapturePayload | undefined;
  let rejectWait: ((err: Error) => void) | undefined;
  let resolveWait: ((payload: CapturePayload) => void) | undefined;
  let ttlTimer: NodeJS.Timeout | undefined;

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url || "/", `http://127.0.0.1`);

    if (req.method === "OPTIONS" && url.pathname === "/capture") {
      setCors(res, origin);
      res.statusCode = isAllowedOrigin(origin) ? 204 : 403;
      res.end();
      return;
    }

    if (req.method === "GET" && (url.pathname === "/install" || url.pathname === "/")) {
      const html = buildInstallHtml(
        (server.address() as { port: number }).port,
        nonce
      );
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(html);
      return;
    }

    if (req.method === "POST" && url.pathname === "/capture") {
      setCors(res, origin);
      if (origin && !isAllowedOrigin(origin)) {
        res.statusCode = 403;
        res.end("forbidden origin");
        return;
      }
      if (expired || disposed) {
        res.statusCode = 410;
        res.end("expired");
        return;
      }
      if (consumed) {
        res.statusCode = 409;
        res.end("nonce reused");
        return;
      }
      try {
        const body = await readJsonBody(req);
        const bodyNonce = typeof body.nonce === "string" ? body.nonce : "";
        const authorization =
          typeof body.authorization === "string" ? body.authorization : "";
        const deviceid =
          typeof body.deviceid === "string" ? body.deviceid : undefined;
        if (!bodyNonce || bodyNonce !== nonce) {
          res.statusCode = 403;
          res.end("invalid nonce");
          return;
        }
        if (!authorization) {
          res.statusCode = 400;
          res.end("missing authorization");
          return;
        }
        consumed = true;
        const payload: CapturePayload = {
          nonce,
          authorization,
          ...(deviceid ? { deviceid } : {}),
        };
        resolved = payload;
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
        resolveWait?.(payload);
        // Nonce is single-use; caller dispose() closes the listener.
        return;
      } catch {
        res.statusCode = 400;
        res.end("bad request");
        return;
      }
    }

    res.statusCode = 404;
    res.end("not found");
  });

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (ttlTimer) clearTimeout(ttlTimer);
    server.close();
    if (!resolved) {
      rejectWait?.(new Error("capture session disposed"));
    }
  }

  ttlTimer = setTimeout(() => {
    expired = true;
    if (!resolved) {
      rejectWait?.(new Error("capture session expired"));
    }
    dispose();
  }, ttlMs);
  // Allow process to exit in tests if nothing else is pending.
  ttlTimer.unref?.();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    dispose();
    throw new Error("failed to bind loopback capture listener");
  }
  const port = addr.port;
  const installUrl = `http://127.0.0.1:${port}/install`;

  const session: CaptureSession = {
    port,
    nonce,
    installUrl,
    waitForCapture(signal?: AbortSignal) {
      if (resolved) return Promise.resolve(resolved);
      if (expired || disposed) {
        return Promise.reject(new Error("capture session expired"));
      }
      return new Promise<CapturePayload>((resolve, reject) => {
        resolveWait = resolve;
        rejectWait = reject;
        if (signal) {
          const onAbort = () => {
            reject(new Error("capture aborted"));
            dispose();
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    },
    dispose,
  };

  return session;
}
