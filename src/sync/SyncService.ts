import * as vscode from "vscode";
import type { RappiConfig } from "../core/schemas/config";
import type { CartResponse } from "../core/schemas/cart";
import type { OrdersResponse } from "../core/schemas/order";
import type { RappiUser } from "../core/schemas/auth";
import { getUser, isPrime } from "../core/services/auth";
import { getCarts } from "../core/services/cart";
import { getOrders } from "../core/services/order";
import { RappiHttpError } from "../core/http";
import type { ConfigStore } from "../core/configStore";

export type SyncSnapshot = {
  ok: boolean;
  error?: string;
  authExpired?: boolean;
  user?: Pick<RappiUser, "name" | "email"> & { is_prime?: boolean };
  carts: CartResponse[];
  orders?: OrdersResponse;
  cartItemCount: number;
  activeOrderEta?: string;
  syncedAt: string;
};

type Listener = (snap: SyncSnapshot) => void;

export class SyncService implements vscode.Disposable {
  private interval: NodeJS.Timeout | undefined;
  private backoffTimer: NodeJS.Timeout | undefined;
  private listeners = new Set<Listener>();
  private statusBar: vscode.StatusBarItem;
  private last?: SyncSnapshot;
  private failures = 0;
  private disposed = false;
  private inFlight: Promise<SyncSnapshot> | undefined;

  constructor(private readonly configStore: ConfigStore) {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBar.command = "rappi.login";
    this.statusBar.text = "$(package) Rappi";
    this.statusBar.tooltip = "Inicia sesión o abre Rappi";
    this.statusBar.show();
  }

  get snapshot(): SyncSnapshot | undefined {
    return this.last;
  }

  onChange(listener: Listener): vscode.Disposable {
    this.listeners.add(listener);
    if (this.last) listener(this.last);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  }

  start(): void {
    void this.tick();
    this.reschedule();
  }

  stopTimers(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = undefined;
    }
  }

  reschedule(): void {
    this.stopTimers();
    const seconds = vscode.workspace
      .getConfiguration("rappi")
      .get<number>("syncIntervalSeconds", 30);
    const ms = Math.max(10, seconds) * 1000;
    this.interval = setInterval(() => void this.tick(), ms);
  }

  async syncNow(): Promise<SyncSnapshot> {
    return this.tick();
  }

  private emit(snap: SyncSnapshot): void {
    this.last = snap;
    this.updateStatusBar(snap);
    for (const l of this.listeners) {
      try {
        l(snap);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  private updateStatusBar(snap: SyncSnapshot): void {
    if (!snap.ok) {
      if (snap.authExpired) {
        this.statusBar.text = "$(warning) Rappi · inicia sesión";
        this.statusBar.tooltip =
          snap.error || "Inicia sesión en Rappi para continuar";
        this.statusBar.command = "rappi.login";
      } else {
        this.statusBar.text = "$(sync-ignored) Rappi · sync error";
        this.statusBar.tooltip = snap.error || "Sync failed";
        this.statusBar.command = "rappi.openSidebar";
      }
      return;
    }
    this.statusBar.command = "rappi.openSidebar";
    const parts = ["$(package) Rappi"];
    if (snap.cartItemCount > 0) parts.push(`cart ${snap.cartItemCount}`);
    if (snap.activeOrderEta) parts.push(`ETA ${snap.activeOrderEta}`);
    this.statusBar.text = parts.join(" · ");
    this.statusBar.tooltip = `Synced ${snap.syncedAt}${
      snap.user ? ` · ${snap.user.name}` : ""
    }`;
  }

  private async tick(): Promise<SyncSnapshot> {
    if (this.disposed) {
      return (
        this.last || {
          ok: false,
          error: "disposed",
          carts: [],
          cartItemCount: 0,
          syncedAt: new Date().toISOString(),
        }
      );
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.runTick().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async runTick(): Promise<SyncSnapshot> {
    let config: RappiConfig;
    try {
      config = await this.configStore.load();
    } catch (err: unknown) {
      const snap: SyncSnapshot = {
        ok: false,
        authExpired: true,
        error: err instanceof Error ? err.message : String(err),
        carts: [],
        cartItemCount: 0,
        syncedAt: new Date().toISOString(),
      };
      this.emit(snap);
      return snap;
    }

    try {
      const [user, prime, carts, orders] = await Promise.all([
        getUser(config),
        isPrime(config).catch(() => false),
        getCarts(config),
        getOrders(config).catch(() => undefined),
      ]);

      const cartItemCount = carts.reduce(
        (n, c) =>
          n +
          c.stores.reduce(
            (m, s) =>
              m + s.products.reduce((p, pr) => p + (pr.units || 0), 0),
            0
          ),
        0
      );

      const active = orders?.active_orders?.[0];
      const snap: SyncSnapshot = {
        ok: true,
        user: { name: user.name, email: user.email, is_prime: prime },
        carts,
        orders,
        cartItemCount,
        activeOrderEta: active?.eta,
        syncedAt: new Date().toISOString(),
      };
      this.failures = 0;
      this.emit(snap);
      return snap;
    } catch (err: unknown) {
      this.failures += 1;
      const authExpired =
        err instanceof RappiHttpError
          ? err.isAuthError
          : /401|403|Unauthorized|Forbidden/i.test(
              err instanceof Error ? err.message : String(err)
            );
      const msg = err instanceof Error ? err.message : String(err);
      const snap: SyncSnapshot = {
        ok: false,
        authExpired,
        error: msg,
        carts: this.last?.carts || [],
        cartItemCount: this.last?.cartItemCount || 0,
        orders: this.last?.orders,
        syncedAt: new Date().toISOString(),
      };
      this.emit(snap);

      if (this.failures >= 3) {
        this.stopTimers();
        const backoff = Math.min(300_000, 30_000 * this.failures);
        this.backoffTimer = setTimeout(() => {
          this.failures = 0;
          this.reschedule();
          void this.tick();
        }, backoff);
      }
      return snap;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopTimers();
    this.statusBar.dispose();
    this.listeners.clear();
  }
}
