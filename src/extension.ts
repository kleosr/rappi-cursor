import * as vscode from "vscode";
import { ConfigStore } from "./core/configStore";
import { SyncService } from "./sync/SyncService";
import { RappiSidebarProvider } from "./ui/webview/RappiSidebarProvider";
import { getUser, isPrime } from "./core/services/auth";
import { getCarts, resolveStoreType, recalculateCart, primaryCartStoreType } from "./core/services/cart";
import { getCheckoutDetail } from "./core/services/checkout";
import { placeOrder, getOrders } from "./core/services/order";
import { search } from "./core/services/search";
import { getAddresses } from "./core/services/address";
import { DEFAULT_STORE_TYPE, LOGIN_URL } from "./core/constants";
import { formatPrice } from "./core/formatters";
import {
  isConnectAllowed,
  startCaptureSession,
  type CaptureSession,
} from "./core/sessionCapture";
import { completeCaptureHandoff } from "./core/captureHandoff";

let syncService: SyncService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const configStore = new ConfigStore(context);
  syncService = new SyncService(configStore);
  const sidebar = new RappiSidebarProvider(
    context.extensionUri,
    configStore,
    syncService
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      RappiSidebarProvider.viewType,
      sidebar
    ),
    syncService,
    sidebar
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("rappi.syncIntervalSeconds")) {
        syncService?.reschedule();
      }
    })
  );

  // Sync immediately when Cursor window regains focus (plan: non-stop + focus)
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void syncService?.syncNow();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rappi.openSidebar", async () => {
      await vscode.commands.executeCommand("rappi.sidebar.focus");
    })
  );

  const ADVANCED_PASTE = "Advanced: paste Authorization";

  const finishAuthenticated = async (userName: string, prime: boolean) => {
    void vscode.window.showInformationMessage(
      `Sesión Rappi OK: ${userName}${prime ? " (Prime)" : ""}. Ya puedes buscar y pedir.`
    );
    syncService?.start();
    await syncService?.syncNow();
    await vscode.commands.executeCommand("rappi.sidebar.focus");
  };

  /** Advanced fallback — DevTools paste; not the default Connect path. */
  const runAdvancedPaste = async () => {
    const token = await vscode.window.showInputBox({
      title: "Advanced · Token de Rappi",
      prompt:
        "Pega Authorization (ft.gAAAAA…). El prefijo Bearer es opcional. Prefer Connect when available.",
      password: true,
      ignoreFocusOut: true,
      placeHolder: "ft.gAAAAA…",
    });
    if (!token) {
      void vscode.window.showWarningMessage(
        "Sin token no hay sesión de Rappi. Ejecuta Rappi: Iniciar sesión cuando quieras."
      );
      return;
    }

    const deviceId = await vscode.window.showInputBox({
      title: "Advanced · deviceid (opcional)",
      prompt:
        "Mismo request de Network → header deviceid. Vacío = generar uno nuevo.",
      ignoreFocusOut: true,
    });

    try {
      let config = await configStore.setupFromToken({
        token,
        deviceId: deviceId || undefined,
      });
      try {
        const { addresses } = await getAddresses(config);
        const active = addresses.find((a) => a.active) || addresses[0];
        if (
          active &&
          typeof active.lat === "number" &&
          typeof active.lng === "number"
        ) {
          await configStore.updateCoords(active.lat, active.lng);
          config = await configStore.load();
        }
      } catch {
        /* keep default coords if addresses fail */
      }
      const user = await getUser(config);
      const prime = await isPrime(config);
      await finishAuthenticated(user.name, prime);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(
        `No se pudo autenticar en Rappi: ${msg.replace(/Bearer\s+\S+/gi, "[redacted]")}. Vuelve a intentar Rappi: Iniciar sesión.`
      );
      await configStore.clear();
      await syncService?.syncNow();
    }
  };

  const runConnect = async (): Promise<"ok" | "miss"> => {
    let session: CaptureSession | undefined;
    try {
      session = await startCaptureSession();
      await vscode.env.openExternal(vscode.Uri.parse(LOGIN_URL));
      await vscode.env.openExternal(vscode.Uri.parse(session.installUrl));
      void vscode.window.showInformationMessage(
        "Connect: inicia sesión en rappi.com.co, luego usa Connect Cursor en la página helper y refresca la pestaña de Rappi."
      );

      const payload = await session.waitForCapture();
      session.dispose();
      session = undefined;

      const result = await completeCaptureHandoff(configStore, payload, {
        getAddresses,
        getUser,
        isPrime,
      });
      if (!result.ok) {
        void vscode.window.showErrorMessage(
          `No se pudo autenticar en Rappi: ${result.error}. Vuelve a intentar Connect o usa advanced paste.`
        );
        await syncService?.syncNow();
        return "miss";
      }
      await finishAuthenticated(result.userName, result.isPrime);
      return "ok";
    } catch {
      session?.dispose();
      return "miss";
    }
  };

  const offerAdvancedAfterMiss = async () => {
    const again = await vscode.window.showWarningMessage(
      "No se capturó la sesión a tiempo. Reintenta Connect o usa advanced paste (DevTools).",
      { modal: true },
      "Retry Connect",
      ADVANCED_PASTE
    );
    if (again === "Retry Connect") {
      if ((await runConnect()) === "ok") return;
      const fallback = await vscode.window.showWarningMessage(
        "Connect no capturó la sesión. Puedes pegar Authorization en modo advanced.",
        { modal: true },
        ADVANCED_PASTE
      );
      if (fallback === ADVANCED_PASTE) {
        await runAdvancedPaste();
      }
      return;
    }
    if (again === ADVANCED_PASTE) {
      await runAdvancedPaste();
    }
  };

  const runSetup = async () => {
    if (!isConnectAllowed(vscode.env.remoteName)) {
      const choice = await vscode.window.showWarningMessage(
        "Connect solo funciona en Cursor local (no Remote SSH). Usa advanced paste en esta máquina remota.",
        { modal: true },
        ADVANCED_PASTE
      );
      if (choice === ADVANCED_PASTE) {
        await runAdvancedPaste();
      }
      return;
    }

    const start = await vscode.window.showInformationMessage(
      "Connect Cursor a Rappi: abrimos rappi.com.co. Inicia sesión y usa el helper Connect Cursor — sin DevTools.",
      { modal: true },
      "Connect",
      ADVANCED_PASTE
    );
    if (!start) return;

    if (start === ADVANCED_PASTE) {
      await runAdvancedPaste();
      return;
    }

    if ((await runConnect()) === "ok") return;
    await offerAdvancedAfterMiss();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("rappi.setup", runSetup),
    vscode.commands.registerCommand("rappi.login", runSetup)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rappi.logout", async () => {
      await configStore.clear();
      await syncService?.syncNow();
      void vscode.window.showInformationMessage("Rappi credentials cleared.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rappi.syncNow", async () => {
      const snap = await syncService?.syncNow();
      if (snap?.ok) {
        void vscode.window.showInformationMessage(
          `Rappi synced · cart ${snap.cartItemCount}`
        );
      } else {
        void vscode.window.showWarningMessage(
          snap?.error || "Rappi sync failed"
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rappi.whoami", async () => {
      try {
        const config = await configStore.load();
        const [user, prime] = await Promise.all([
          getUser(config),
          isPrime(config),
        ]);
        void vscode.window.showInformationMessage(
          `${user.name} · ${user.email} · Prime: ${prime ? "yes" : "no"}`
        );
      } catch (err: unknown) {
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err)
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rappi.search", async () => {
      const query = await vscode.window.showInputBox({
        title: "Rappi search",
        placeHolder: "hamburguesa, pizza…",
      });
      if (!query) return;
      try {
        const config = await configStore.load();
        const result = await search(query, config);
        const lines = result.stores.slice(0, 8).flatMap((s) => {
          const head = `[${s.store_id}] ${s.store_name}`;
          const products = s.products
            .slice(0, 3)
            .map(
              (p) =>
                `  [${p.product_id}] ${p.name} — ${formatPrice(p.price)}${
                  p.has_toppings ? " [+options]" : ""
                }`
            );
          return [head, ...products];
        });
        const doc = await vscode.workspace.openTextDocument({
          content: lines.join("\n") || "No results",
          language: "markdown",
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err: unknown) {
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err)
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rappi.cart", async () => {
      try {
        const config = await configStore.load();
        const carts = await getCarts(config);
        const content = JSON.stringify(carts, null, 2);
        const doc = await vscode.workspace.openTextDocument({
          content,
          language: "json",
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err: unknown) {
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err)
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rappi.checkout", async () => {
      try {
        const config = await configStore.load();
        const storeType = await primaryCartStoreType(config, DEFAULT_STORE_TYPE);
        const resolved = await resolveStoreType(storeType, config);
        const [cart, detail] = await Promise.allSettled([
          recalculateCart(resolved, config),
          getCheckoutDetail(resolved, config),
        ]);
        const content = JSON.stringify(
          {
            store_type: resolved,
            cart: cart.status === "fulfilled" ? cart.value : null,
            detail: detail.status === "fulfilled" ? detail.value : null,
          },
          null,
          2
        );
        const doc = await vscode.workspace.openTextDocument({
          content,
          language: "json",
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err: unknown) {
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err)
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rappi.placeOrder", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Place this Rappi order now? This will charge your payment method on file.",
        { modal: true },
        "Place order"
      );
      if (confirm !== "Place order") return;
      try {
        const config = await configStore.load();
        const storeType = await primaryCartStoreType(config, DEFAULT_STORE_TYPE);
        const resolved = await resolveStoreType(storeType, config);
        const result = await placeOrder(resolved, config);
        await syncService?.syncNow();
        void vscode.window.showInformationMessage(
          `Order placed: ${JSON.stringify(result).slice(0, 120)}`
        );
      } catch (err: unknown) {
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err)
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rappi.orders", async () => {
      try {
        const config = await configStore.load();
        const orders = await getOrders(config);
        const doc = await vscode.workspace.openTextDocument({
          content: JSON.stringify(orders, null, 2),
          language: "json",
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err: unknown) {
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err)
        );
      }
    })
  );

  void configStore.hasCredentials().then(async (ok) => {
    if (ok) {
      syncService?.start();
      return;
    }
    void syncService?.syncNow();
    await vscode.commands.executeCommand("rappi.sidebar.focus");
    const action = await vscode.window.showWarningMessage(
      "Rappi necesita tu sesión. Inicia sesión con tu cuenta de Rappi para buscar y pedir.",
      "Iniciar sesión"
    );
    if (action === "Iniciar sesión") {
      await runSetup();
    }
  });
}

export function deactivate(): void {
  syncService?.dispose();
  syncService = undefined;
}
