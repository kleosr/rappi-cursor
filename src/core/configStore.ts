import * as vscode from "vscode";
import { randomUUID } from "crypto";
import type { RappiConfig } from "../core/schemas/config";
import {
  clearConfigOnDisk,
  loadConfigFromDisk,
  saveConfigToDisk,
  bridgeConfigPath,
} from "../core/config";
import { DEFAULT_COORDS } from "../core/constants";

const SECRET_TOKEN = "rappi.token";
const SECRET_DEVICE = "rappi.deviceId";
const STATE_LAT = "rappi.lat";
const STATE_LNG = "rappi.lng";

/**
 * SecretStorage is primary. Bridge file (~/.config/rappi-cursor/config.json)
 * is written only on persist so MCP can share credentials — never on every read.
 */
export class ConfigStore {
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  bridgePath(): string {
    return bridgeConfigPath();
  }

  async hasCredentials(): Promise<boolean> {
    try {
      await this.load();
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<RappiConfig> {
    const token = await this.ctx.secrets.get(SECRET_TOKEN);
    const deviceId = await this.ctx.secrets.get(SECRET_DEVICE);
    const lat =
      this.ctx.globalState.get<number>(STATE_LAT) ??
      vscode.workspace.getConfiguration("rappi").get<number>("defaultLat") ??
      DEFAULT_COORDS.lat;
    const lng =
      this.ctx.globalState.get<number>(STATE_LNG) ??
      vscode.workspace.getConfiguration("rappi").get<number>("defaultLng") ??
      DEFAULT_COORDS.lng;

    if (token && deviceId) {
      return { token, deviceId, lat, lng };
    }

    // Import from MCP bridge if extension secrets are empty
    const disk = loadConfigFromDisk();
    await this.persist(disk);
    return disk;
  }

  async persist(config: RappiConfig): Promise<void> {
    await this.ctx.secrets.store(SECRET_TOKEN, config.token);
    await this.ctx.secrets.store(SECRET_DEVICE, config.deviceId);
    await this.ctx.globalState.update(STATE_LAT, config.lat);
    await this.ctx.globalState.update(STATE_LNG, config.lng);
    saveConfigToDisk(config);
  }

  /** Refresh MCP bridge from current secrets (explicit). */
  async syncBridge(): Promise<void> {
    const config = await this.load();
    saveConfigToDisk(config);
  }

  async updateCoords(lat: number, lng: number): Promise<void> {
    const config = await this.load();
    config.lat = lat;
    config.lng = lng;
    await this.persist(config);
  }

  async setupFromToken(opts: {
    token: string;
    deviceId?: string;
    lat?: number;
    lng?: number;
  }): Promise<RappiConfig> {
    let token = opts.token.trim();
    if (token.toLowerCase().startsWith("bearer ")) {
      token = token.slice(7).trim();
    }
    if (!token) {
      throw new Error("Empty token");
    }

    const existingDevice = await this.ctx.secrets.get(SECRET_DEVICE);
    const cfg = vscode.workspace.getConfiguration("rappi");
    const config: RappiConfig = {
      token,
      deviceId:
        opts.deviceId?.trim() || existingDevice || randomUUID(),
      lat: opts.lat ?? cfg.get<number>("defaultLat") ?? DEFAULT_COORDS.lat,
      lng: opts.lng ?? cfg.get<number>("defaultLng") ?? DEFAULT_COORDS.lng,
    };
    await this.persist(config);
    return config;
  }

  async clear(): Promise<void> {
    await this.ctx.secrets.delete(SECRET_TOKEN);
    await this.ctx.secrets.delete(SECRET_DEVICE);
    await this.ctx.globalState.update(STATE_LAT, undefined);
    await this.ctx.globalState.update(STATE_LNG, undefined);
    clearConfigOnDisk();
  }
}
