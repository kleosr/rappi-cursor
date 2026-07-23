import * as vscode from "vscode";
import { ConfigStore } from "../../core/configStore";
import { DEFAULT_STORE_TYPE } from "../../core/constants";
import { search } from "../../core/services/search";
import { getRestaurantCatalog, getStoreDetail } from "../../core/services/store";
import { getProductToppings } from "../../core/services/product";
import {
  addToCart,
  removeFromCart,
  recalculateCart,
  resolveStoreType,
} from "../../core/services/cart";
import {
  getCheckoutDetail,
  getCheckoutWidgets,
  setTip,
} from "../../core/services/checkout";
import { placeOrder, getOrders } from "../../core/services/order";
import {
  getAddresses,
  setActiveAddress,
} from "../../core/services/address";
import { getUser, isPrime } from "../../core/services/auth";
import type { SyncService } from "../../sync/SyncService";

export class RappiSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "rappi.sidebar";
  private view?: vscode.WebviewView;
  private syncSub?: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly configStore: ConfigStore,
    private readonly sync: SyncService
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };
    webviewView.webview.html = this.html(webviewView.webview);

    this.syncSub?.dispose();
    this.syncSub = this.sync.onChange((snap) => {
      void webviewView.webview.postMessage({ type: "sync", snapshot: snap });
    });

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        await this.handleMessage(msg);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        void webviewView.webview.postMessage({
          type: "error",
          message,
        });
      }
    });

    void this.sync.syncNow();
  }

  post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private async handleMessage(msg: {
    type: string;
    [k: string]: unknown;
  }): Promise<void> {
    const reply = (payload: unknown) =>
      void this.view?.webview.postMessage(payload);

    switch (msg.type) {
      case "ready":
        reply({ type: "sync", snapshot: this.sync.snapshot });
        return;

      case "setup": {
        await vscode.commands.executeCommand("rappi.setup");
        await this.sync.syncNow();
        return;
      }

      case "syncNow":
        await this.sync.syncNow();
        return;

      case "search": {
        const config = await this.configStore.load();
        const q = String(msg.query || "");
        const result = await search(q, config);
        reply({ type: "searchResult", result });
        return;
      }

      case "restaurants": {
        const config = await this.configStore.load();
        const catalog = await getRestaurantCatalog(config, {
          limit: Number(msg.limit) || 20,
        });
        reply({ type: "restaurantsResult", catalog });
        return;
      }

      case "store": {
        const config = await this.configStore.load();
        const store = await getStoreDetail(Number(msg.storeId), config);
        reply({ type: "storeResult", store });
        return;
      }

      case "product": {
        const config = await this.configStore.load();
        const toppings = await getProductToppings(
          Number(msg.storeId),
          Number(msg.productId),
          config
        );
        reply({
          type: "productResult",
          storeId: msg.storeId,
          productId: msg.productId,
          name: msg.name,
          price: msg.price,
          toppings,
        });
        return;
      }

      case "addToCart": {
        const config = await this.configStore.load();
        const storeId = Number(msg.storeId);
        const productId = String(msg.productId);
        const name = String(msg.name || "Product");
        const quantity = Number(msg.quantity) || 1;
        const toppings = (msg.toppings as number[]) || [];
        const price = Number(msg.price) || 0;
        await addToCart(
          DEFAULT_STORE_TYPE,
          [
            {
              id: storeId,
              products: [
                { id: productId, name, toppings, units: quantity, price },
              ],
            },
          ],
          config
        );
        await this.sync.syncNow();
        reply({ type: "toast", message: `Added ${name} to cart` });
        return;
      }

      case "removeFromCart": {
        const config = await this.configStore.load();
        const storeType = String(msg.storeType || DEFAULT_STORE_TYPE);
        await removeFromCart(storeType, String(msg.productId), config);
        await this.sync.syncNow();
        reply({ type: "toast", message: "Removed from cart" });
        return;
      }

      case "setTip": {
        const config = await this.configStore.load();
        const storeType = await resolveStoreType(
          String(msg.storeType || DEFAULT_STORE_TYPE),
          config
        );
        await setTip(storeType, Number(msg.amount) || 0, config);
        await this.sync.syncNow();
        reply({ type: "toast", message: "Tip updated" });
        return;
      }

      case "checkout": {
        const config = await this.configStore.load();
        const storeType = await resolveStoreType(
          String(msg.storeType || DEFAULT_STORE_TYPE),
          config
        );
        const [cart, detail, widgets] = await Promise.allSettled([
          recalculateCart(storeType, config),
          getCheckoutDetail(storeType, config),
          getCheckoutWidgets(storeType, config),
        ]);
        reply({
          type: "checkoutResult",
          storeType,
          cart: cart.status === "fulfilled" ? cart.value : null,
          detail: detail.status === "fulfilled" ? detail.value : null,
          widgets: widgets.status === "fulfilled" ? widgets.value : null,
        });
        return;
      }

      case "placeOrder": {
        const storeType = String(msg.storeType || DEFAULT_STORE_TYPE);
        const confirm = await vscode.window.showWarningMessage(
          "Place this Rappi order now? This will charge your payment method on file.",
          { modal: true },
          "Place order"
        );
        if (confirm !== "Place order") {
          reply({ type: "toast", message: "Order cancelled" });
          return;
        }
        const config = await this.configStore.load();
        const resolved = await resolveStoreType(storeType, config);
        const result = await placeOrder(resolved, config);
        await this.sync.syncNow();
        reply({ type: "orderPlaced", result });
        void vscode.window.showInformationMessage("Rappi order placed.");
        return;
      }

      case "orders": {
        const config = await this.configStore.load();
        const orders = await getOrders(config);
        reply({ type: "ordersResult", orders });
        return;
      }

      case "addresses": {
        const config = await this.configStore.load();
        const data = await getAddresses(config);
        reply({ type: "addressesResult", addresses: data.addresses });
        return;
      }

      case "setAddress": {
        const addressId = Number(msg.addressId);
        const label = String(msg.label || addressId);
        const confirm = await vscode.window.showWarningMessage(
          `Set delivery address to:\n${label}?`,
          { modal: true },
          "Set address"
        );
        if (confirm !== "Set address") {
          reply({ type: "toast", message: "Address change cancelled" });
          return;
        }
        const config = await this.configStore.load();
        const { addresses } = await getAddresses(config);
        const addr = addresses.find((a) => a.id === addressId);
        await setActiveAddress(addressId, config);
        if (addr) {
          await this.configStore.updateCoords(addr.lat, addr.lng);
        }
        await this.sync.syncNow();
        reply({ type: "toast", message: `Address set: ${label}` });
        reply({
          type: "addressesResult",
          addresses: (await getAddresses(await this.configStore.load()))
            .addresses,
        });
        return;
      }

      case "whoami": {
        const config = await this.configStore.load();
        const [user, prime] = await Promise.all([
          getUser(config),
          isPrime(config),
        ]);
        reply({ type: "whoamiResult", user, is_prime: prime });
        return;
      }

      case "openLogin": {
        await vscode.env.openExternal(
          vscode.Uri.parse("https://www.rappi.com.co/login")
        );
        return;
      }

      default:
        return;
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = String(Date.now());
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "sidebar.css")
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "rappi-wordmark.svg")
    );
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Rappi</title>
</head>
<body class="locked">
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <header class="brand">
    <img src="${logoUri}" alt="Rappi" width="120" height="32" />
    <span class="tag">Cursor</span>
  </header>

  <section id="authGate" class="auth-gate" aria-label="Iniciar sesión">
    <h2>Inicia sesión en Rappi</h2>
    <p>Para buscar, armar el carrito y pedir, autentica tu cuenta de Rappi.</p>
    <div class="steps">
      <strong>Cómo hacerlo</strong>
      <ol>
        <li>Abre Rappi e inicia sesión (teléfono / WhatsApp).</li>
        <li>DevTools (F12) → Network → <code>grability.rappi.com</code>.</li>
        <li>Copia el header <code>Authorization</code> (<code>ft.gAAAAA…</code>).</li>
        <li>Pégalo aquí cuando te lo pedimos.</li>
      </ol>
    </div>
    <button class="primary" id="btnLogin" style="width:100%">Iniciar sesión en Rappi</button>
    <button class="ghost" id="btnOpenLoginGate" style="width:100%">Solo abrir rappi.com.co</button>
  </section>

  <div class="app" id="app">
  <div id="status" class="status" data-state="warn" role="status">
    <span class="dot" aria-hidden="true"></span>
    <span id="statusText">Starting…</span>
  </div>
  <div id="err" class="err" role="alert"></div>

  <div class="tabs" role="tablist" aria-label="Rappi sections">
    <button role="tab" data-tab="browse" aria-selected="true" class="active">Browse</button>
    <button role="tab" data-tab="cart" aria-selected="false">Cart</button>
    <button role="tab" data-tab="checkout" aria-selected="false">Checkout</button>
    <button role="tab" data-tab="orders" aria-selected="false">Orders</button>
    <button role="tab" data-tab="account" aria-selected="false">Account</button>
  </div>

  <section id="browse" class="panel active" role="tabpanel">
    <div class="row">
      <input id="q" type="search" placeholder="Search food, stores…" aria-label="Search" />
      <button class="primary" id="btnSearch">Search</button>
    </div>
    <div class="row">
      <button class="ghost" id="btnRestaurants">Nearby</button>
      <button class="ghost" id="btnSync">Sync</button>
    </div>
    <div id="browseOut"><div class="empty"><strong>Search Rappi</strong>Find restaurants and products near you.</div></div>
    <div id="productOut"></div>
  </section>

  <section id="cart" class="panel" role="tabpanel" hidden>
    <div id="cartOut"><div class="empty"><strong>Cart empty</strong>Add items from Browse.</div></div>
    <div class="row" style="margin-top:12px">
      <input id="tipAmt" type="number" min="0" step="100" placeholder="Tip (COP)" aria-label="Tip amount" />
      <button class="ghost" id="btnTip">Set tip</button>
    </div>
  </section>

  <section id="checkout" class="panel" role="tabpanel" hidden>
    <div class="row">
      <button class="ghost" id="btnCheckout">Preview</button>
      <button class="primary" id="btnPlace">Place order</button>
    </div>
    <div id="checkoutOut"><div class="empty"><strong>Checkout</strong>Preview totals before placing.</div></div>
  </section>

  <section id="orders" class="panel" role="tabpanel" hidden>
    <div class="row"><button class="ghost" id="btnOrders">Refresh</button></div>
    <div id="ordersOut"><div class="empty"><strong>No orders yet</strong>Active deliveries show up here.</div></div>
  </section>

  <section id="account" class="panel" role="tabpanel" hidden>
    <div class="stack">
      <button class="primary" id="btnSetup">Iniciar sesión / renovar token</button>
      <button class="ghost" id="btnOpenLogin">Abrir rappi.com.co</button>
      <button class="ghost" id="btnWhoami">Quién soy</button>
      <button class="ghost" id="btnAddresses">Direcciones</button>
    </div>
    <div id="accountOut" style="margin-top:12px"></div>
  </section>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let lastStoreType = "restaurant";

    function $(id) { return document.getElementById(id); }
    function empty(title, body) {
      return '<div class="empty"><strong>' + escapeHtml(title) + '</strong>' + escapeHtml(body) + '</div>';
    }
    function showToast(msg) {
      const el = $("toast");
      el.textContent = msg;
      el.style.display = "block";
      setTimeout(() => { el.style.display = "none"; }, 2500);
    }
    function setErr(msg) { $("err").textContent = msg || ""; }
    function money(n) {
      try { return "$" + Number(n||0).toLocaleString("es-CO"); }
      catch { return "$" + n; }
    }
    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
    /** Strip Rappi HTML blobs (<BR/>, <font>, <b>) to plain text. */
    function cleanText(s) {
      if (s == null || s === "") return "";
      return String(s)
        .replace(/<br[^>]*>/gi, " ")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \\t\\n\\r\\f]+/g, " ")
        .trim();
    }
    function label(s) {
      return escapeHtml(cleanText(s));
    }
    function setStatus(state, text) {
      const box = $("status");
      box.dataset.state = state;
      $("statusText").textContent = text;
    }
    function setLoading(el, label) {
      el.innerHTML = '<div class="loading">' + escapeHtml(label || "Loading…") + '</div>';
    }

    document.querySelectorAll(".tabs [role=tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tabs [role=tab]").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });
        document.querySelectorAll(".panel").forEach((p) => {
          p.classList.remove("active");
          p.hidden = true;
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        const panel = $(btn.dataset.tab);
        panel.classList.add("active");
        panel.hidden = false;
      });
    });

    $("btnSearch").onclick = () => {
      setErr("");
      setLoading($("browseOut"), "Searching…");
      $("productOut").innerHTML = "";
      vscode.postMessage({ type: "search", query: $("q").value });
    };
    $("q").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("btnSearch").click();
    });
    $("btnRestaurants").onclick = () => {
      setLoading($("browseOut"), "Loading restaurants…");
      vscode.postMessage({ type: "restaurants", limit: 20 });
    };
    $("btnSync").onclick = () => vscode.postMessage({ type: "syncNow" });
    $("btnTip").onclick = () => vscode.postMessage({
      type: "setTip", amount: Number($("tipAmt").value||0), storeType: lastStoreType
    });
    $("btnCheckout").onclick = () => {
      setLoading($("checkoutOut"), "Building checkout…");
      vscode.postMessage({ type: "checkout", storeType: lastStoreType });
    };
    $("btnPlace").onclick = () => vscode.postMessage({ type: "placeOrder", storeType: lastStoreType });
    $("btnOrders").onclick = () => {
      setLoading($("ordersOut"), "Loading orders…");
      vscode.postMessage({ type: "orders" });
    };
    function setAuthed(ok) {
      document.body.classList.toggle("locked", !ok);
    }
    $("btnLogin").onclick = () => vscode.postMessage({ type: "setup" });
    $("btnOpenLoginGate").onclick = () => vscode.postMessage({ type: "openLogin" });
    $("btnSetup").onclick = () => vscode.postMessage({ type: "setup" });
    $("btnOpenLogin").onclick = () => vscode.postMessage({ type: "openLogin" });
    $("btnWhoami").onclick = () => {
      setLoading($("accountOut"), "Loading profile…");
      vscode.postMessage({ type: "whoami" });
    };
    $("btnAddresses").onclick = () => {
      setLoading($("accountOut"), "Loading addresses…");
      vscode.postMessage({ type: "addresses" });
    };

    function productButtons(root) {
      root.querySelectorAll("[data-prod]").forEach((btn) => {
        btn.onclick = () => {
          const hasTop = btn.getAttribute("data-top") === "1";
          const payload = {
            storeId: Number(btn.getAttribute("data-store")),
            productId: btn.getAttribute("data-prod"),
            name: btn.getAttribute("data-name"),
            price: Number(btn.getAttribute("data-price")),
          };
          if (hasTop) {
            setLoading($("productOut"), "Loading options…");
            vscode.postMessage({ type: "product", ...payload, productId: Number(payload.productId) });
          } else {
            vscode.postMessage({ type: "addToCart", ...payload, quantity: 1, toppings: [] });
          }
        };
      });
    }

    function renderSync(snap) {
      if (!snap) {
        setAuthed(false);
        setStatus("warn", "Sin sesión");
        return;
      }
      if (!snap.ok) {
        const needAuth = !!snap.authExpired;
        setAuthed(!needAuth);
        setStatus(
          needAuth ? "warn" : "err",
          needAuth
            ? "Inicia sesión en Rappi"
            : ("Error de sync: " + (snap.error || ""))
        );
        if (needAuth) return;
      } else {
        setAuthed(true);
        const u = snap.user ? snap.user.name : "";
        setStatus(
          "ok",
          (u ? u + " · " : "") +
          "cart " + snap.cartItemCount +
          (snap.activeOrderEta ? " · ETA " + snap.activeOrderEta : "") +
          " · " + new Date(snap.syncedAt).toLocaleTimeString()
        );
      }
      renderCart(snap.carts || []);
      if (snap.orders) renderOrders(snap.orders);
    }

    function renderCart(carts) {
      const el = $("cartOut");
      if (!carts.length) {
        el.innerHTML = empty("Cart empty", "Add items from Browse.");
        return;
      }
      lastStoreType = carts[0].store_type || "restaurant";
      el.innerHTML = carts.map((c) => {
        const stores = (c.stores||[]).map((s) => {
          const products = (s.products||[]).map((p) =>
            '<div class="row-item">' +
              '<div><p class="title">' + label(p.name) + ' ×' + p.units + '</p>' +
              '<div class="meta">' + label(p.id) + '</div></div>' +
              '<div class="actions"><span class="price">' + money(p.total || p.price) + '</span>' +
              '<button class="ghost" data-rm="' + escapeHtml(p.id) + '" data-st="' + escapeHtml(c.store_type) + '">Remove</button></div>' +
            '</div>'
          ).join("");
          return '<div class="store-block"><div class="heading">' + label(s.name) +
            ' <span class="meta">' + label(s.eta_label||'') + '</span></div>' +
            products +
            '<div style="margin-top:8px">Total <span class="price">' + money(s.total) + '</span></div></div>';
        }).join("");
        return '<div class="meta" style="margin-bottom:8px">Type: ' + label(c.store_type) + '</div>' + stores;
      }).join("");
      el.querySelectorAll("[data-rm]").forEach((btn) => {
        btn.onclick = () => vscode.postMessage({
          type: "removeFromCart",
          productId: btn.getAttribute("data-rm"),
          storeType: btn.getAttribute("data-st"),
        });
      });
    }

    function renderOrders(orders) {
      const active = (orders.active_orders||[]);
      if (!active.length) {
        $("ordersOut").innerHTML = empty("No active orders", "Placed orders appear here with ETA.");
        return;
      }
      $("ordersOut").innerHTML = active.map((o) =>
        '<div class="row-item"><div><p class="title">' + escapeHtml(o.store?.name||'?') + '</p>' +
        '<div class="meta">' + escapeHtml(o.state) + ' · ETA ' + escapeHtml(String(o.eta||'')) + '</div></div>' +
        '<span class="price">' + money(o.total) + '</span></div>'
      ).join("");
    }

    window.addEventListener("message", (event) => {
      const msg = event.data;
      setErr("");
      switch (msg.type) {
        case "sync":
          renderSync(msg.snapshot);
          break;
        case "error":
          setErr(msg.message);
          break;
        case "toast":
          showToast(msg.message);
          break;
        case "searchResult": {
          const stores = msg.result?.stores || [];
          if (!stores.length) {
            $("browseOut").innerHTML = empty("No results", "Try another search term.");
            break;
          }
          $("browseOut").innerHTML = stores.map((s) => {
            const products = (s.products||[]).slice(0,5).map((p) =>
              '<div class="row-item">' +
                '<div><p class="title">' + escapeHtml(p.name) + '</p>' +
                '<div class="meta">' + (p.has_toppings ? '<span class="badge">options</span> ' : '') +
                'id ' + p.product_id + '</div></div>' +
                '<div class="actions"><span class="price">' + money(p.price) + '</span>' +
                '<button class="' + (p.has_toppings ? 'ghost' : 'primary') + '" data-prod="' + p.product_id +
                '" data-store="' + s.store_id + '" data-name="' + escapeHtml(p.name) +
                '" data-price="' + p.price + '" data-top="' + (p.has_toppings?"1":"0") + '">' +
                (p.has_toppings ? "Options" : "Add") + '</button></div></div>'
            ).join("");
            return '<div class="store-block"><div class="heading">[' + s.store_id + '] ' +
              escapeHtml(s.store_name) + '</div><div class="meta">' + escapeHtml(s.eta||'') +
              ' · ship ' + money(s.shipping_cost) + ' · ' + escapeHtml(s.store_type||'') +
              '</div>' + products + '</div>';
          }).join("");
          productButtons($("browseOut"));
          break;
        }
        case "restaurantsResult": {
          const stores = msg.catalog?.stores || [];
          if (!stores.length) {
            $("browseOut").innerHTML = empty("No restaurants", "Check address or try later.");
            break;
          }
          $("browseOut").innerHTML = stores.map((s) =>
            '<div class="row-item"><div><p class="title">[' + s.store_id + '] ' + escapeHtml(s.name) + '</p>' +
            '<div class="meta">' + escapeHtml(s.eta||'') + ' · ' + money(s.shipping_cost) +
            (s.is_available ? '' : ' · closed') + '</div></div>' +
            '<button class="ghost" data-store-open="' + s.store_id + '">Menu</button></div>'
          ).join("");
          $("browseOut").querySelectorAll("[data-store-open]").forEach((btn) => {
            btn.onclick = () => {
              setLoading($("browseOut"), "Loading menu…");
              vscode.postMessage({ type: "store", storeId: Number(btn.getAttribute("data-store-open")) });
            };
          });
          break;
        }
        case "storeResult": {
          const store = msg.store;
          const corridors = store.corridors || [];
          $("browseOut").innerHTML =
            '<div class="store-block"><div class="heading">' + escapeHtml(store.name) + '</div>' +
            '<div class="meta">' + escapeHtml(store.address||'') + ' · ' +
            escapeHtml(store.status?.status||'') + '</div></div>' +
            corridors.map((c) =>
              '<div class="section-label">' + escapeHtml(c.name) + '</div>' +
              (c.products||[]).slice(0,12).map((p) =>
                '<div class="row-item"><div><p class="title">' + escapeHtml(p.name) + '</p></div>' +
                '<div class="actions"><span class="price">' + money(p.price) + '</span>' +
                '<button class="' + (p.has_toppings ? 'ghost' : 'primary') + '" data-prod="' + p.id +
                '" data-store="' + store.store_id + '" data-name="' + escapeHtml(p.name) +
                '" data-price="' + p.price + '" data-top="' + (p.has_toppings?"1":"0") + '">' +
                (p.has_toppings?"Options":"Add") + '</button></div></div>'
              ).join("")
            ).join("");
          productButtons($("browseOut"));
          break;
        }
        case "productResult": {
          const cats = msg.toppings?.categories || [];
          $("productOut").innerHTML =
            '<div class="section-label">Customize</div>' +
            '<div class="row-item"><div><p class="title">' + escapeHtml(msg.name) + '</p></div>' +
            '<span class="price">' + money(msg.price) + '</span></div>' +
            cats.map((cat, i) =>
              '<div class="topping-cat"><strong>' + escapeHtml(cat.description) +
              (cat.min_toppings_for_categories > 0 ? ' <span class="badge">required</span>' : '') +
              '</strong>' +
              (cat.toppings||[]).map((t) =>
                '<label><input type="checkbox" data-tid="' + t.id + '" data-cat="' + i + '" />' +
                '<span>' + escapeHtml(t.description) + ' <span class="price">' + money(t.price) + '</span></span></label>'
              ).join("") + '</div>'
            ).join("") +
            '<button class="primary" id="btnAddConfigured">Add to cart</button>';
          $("btnAddConfigured").onclick = () => {
            const toppings = [...document.querySelectorAll("#productOut input[data-tid]:checked")]
              .map((el) => Number(el.getAttribute("data-tid")));
            vscode.postMessage({
              type: "addToCart",
              storeId: msg.storeId,
              productId: String(msg.productId),
              name: msg.name,
              price: msg.price,
              quantity: 1,
              toppings,
            });
          };
          break;
        }
        case "checkoutResult": {
          lastStoreType = msg.storeType || lastStoreType;
          const detail = msg.detail;
          const cart = msg.cart;
          let html = "";

          if (cart?.stores?.length) {
            html += cart.stores.map((s) => {
              const products = (s.products||[]).map((p) =>
                '<div class="row-item">' +
                  '<div><p class="title">' + label(p.name) + '</p>' +
                  '<div class="meta">×' + (p.units||1) + '</div></div>' +
                  '<span class="price">' + money(p.total > 0 ? p.total : p.price) + '</span>' +
                '</div>'
              ).join("");
              const charges = (s.charges||[])
                .filter((c) => c.total > 0)
                .map((c) =>
                  '<div class="row-item compact"><div class="meta">' + label(c.charge_type) + '</div>' +
                  '<span class="meta">' + money(c.total) + '</span></div>'
                ).join("");
              return '<div class="store-block">' +
                '<div class="heading">' + label(s.name) + '</div>' +
                (s.eta_label ? '<div class="meta" style="margin-bottom:8px">ETA ' + label(s.eta_label) + '</div>' : '') +
                products + charges +
                '<div class="row-item total-row"><div><p class="title">Total tienda</p></div>' +
                '<span class="price">' + money(s.total) + '</span></div></div>';
            }).join("");
            const grand = cart.sub_total || cart.product_total;
            if (grand != null) {
              html += '<div class="row-item total-row"><div><p class="title">Total pedido</p></div>' +
                '<span class="price">' + money(grand) + '</span></div>';
            }
          } else if (cart) {
            html += '<div class="row-item total-row"><div><p class="title">Cart total</p></div>' +
              '<span class="price">' + money(cart.sub_total || cart.product_total) + '</span></div>';
          }

          if (detail?.summary?.length) {
            html += '<div class="section-label">Resumen</div>';
            html += detail.summary.map((block) => {
              const title = cleanText(block.header?.title || "");
              let blockHtml = title
                ? '<div class="heading" style="margin-top:12px">' + escapeHtml(title) + '</div>'
                : '';
              blockHtml += (block.details || []).map((d) => {
                const type = String(d.type || "").toLowerCase();
                if (type === "separator" || type === "space" || type === "divider") {
                  return '<div class="hairline" role="separator"></div>';
                }
                const key = cleanText(d.key);
                const val = cleanText(d.value);
                if (!key && !val) return "";
                // Rappi sometimes sends type "item" with HTML in value only
                if (!key && val) {
                  return '<div class="row-item compact"><div class="meta">' + escapeHtml(val) + '</div></div>';
                }
                return '<div class="row-item compact"><div class="meta">' + escapeHtml(key) + '</div>' +
                  '<div class="price-sm">' + escapeHtml(val) + '</div></div>';
              }).join("");
              return blockHtml;
            }).join("");
          }

          $("checkoutOut").innerHTML = html || empty("No checkout data", "Add items to cart first.");
          break;
        }
        case "ordersResult":
          renderOrders(msg.orders);
          break;
        case "orderPlaced":
          showToast("Order placed");
          $("checkoutOut").innerHTML = '<pre class="meta" style="white-space:pre-wrap">' +
            escapeHtml(JSON.stringify(msg.result, null, 2)) + '</pre>';
          break;
        case "whoamiResult":
          $("accountOut").innerHTML =
            '<div class="row-item"><div><p class="title">' + escapeHtml(msg.user.name) + '</p>' +
            '<div class="meta">' + escapeHtml(msg.user.email) + '</div></div>' +
            '<span class="badge">' + (msg.is_prime ? "Prime" : "Standard") + '</span></div>';
          break;
        case "addressesResult":
          $("accountOut").innerHTML = (msg.addresses||[]).map((a) =>
            '<div class="row-item"><div><p class="title">[' + a.id + '] ' + escapeHtml(a.tag||a.address) +
            (a.active ? ' <span class="badge">active</span>' : '') + '</p>' +
            '<div class="meta">' + escapeHtml(a.address) + '</div></div>' +
            (a.active ? '' :
              '<button class="ghost" data-addr="' + a.id + '" data-label="' + escapeHtml(a.tag||a.address) +
              '">Set active</button>') +
            '</div>'
          ).join("") || empty("No addresses", "Add one in the Rappi app.");
          $("accountOut").querySelectorAll("[data-addr]").forEach((btn) => {
            btn.onclick = () => vscode.postMessage({
              type: "setAddress",
              addressId: Number(btn.getAttribute("data-addr")),
              label: btn.getAttribute("data-label"),
            });
          });
          break;
      }
    });

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.syncSub?.dispose();
  }
}
