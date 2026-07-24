/**
 * Capture → setupFromToken handoff (testable without vscode).
 * Never log Authorization / Bearer material.
 */

import type { RappiConfig } from "./schemas/config";
import type { CapturePayload } from "./sessionCapture";

export type HandoffStore = {
  setupFromToken(opts: {
    token: string;
    deviceId?: string;
  }): Promise<RappiConfig>;
  updateCoords(lat: number, lng: number): Promise<void>;
  load(): Promise<RappiConfig>;
  clear(): Promise<void>;
};

export type HandoffAddress = {
  active?: boolean;
  lat?: number;
  lng?: number;
};

export type HandoffValidators = {
  getAddresses(config: RappiConfig): Promise<{ addresses: HandoffAddress[] }>;
  getUser(config: RappiConfig): Promise<{ name: string; email?: string }>;
  isPrime(config: RappiConfig): Promise<boolean>;
};

export type HandoffResult =
  | { ok: true; userName: string; isPrime: boolean }
  | { ok: false; error: string };

/**
 * Persist captured Authorization (+ deviceid when present), then validate.
 * On validation failure, clears credentials (same contract as runSetup).
 */
export async function completeCaptureHandoff(
  store: HandoffStore,
  payload: CapturePayload,
  validators: HandoffValidators
): Promise<HandoffResult> {
  try {
    let config = await store.setupFromToken({
      token: payload.authorization,
      deviceId: payload.deviceid,
    });

    try {
      const { addresses } = await validators.getAddresses(config);
      const active = addresses.find((a) => a.active) || addresses[0];
      if (
        active &&
        typeof active.lat === "number" &&
        typeof active.lng === "number"
      ) {
        await store.updateCoords(active.lat, active.lng);
        config = await store.load();
      }
    } catch {
      /* keep default coords if addresses fail */
    }

    const user = await validators.getUser(config);
    const prime = await validators.isPrime(config);
    return { ok: true, userName: user.name, isPrime: prime };
  } catch (err: unknown) {
    await store.clear();
    const message = err instanceof Error ? err.message : String(err);
    // Strip accidental token-shaped substrings from user-facing errors.
    const safe = message.replace(/Bearer\s+\S+/gi, "[redacted]");
    return { ok: false, error: safe };
  }
}
