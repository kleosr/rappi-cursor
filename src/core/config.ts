import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { RappiConfigSchema, type RappiConfig } from "./schemas/config";
import { DEFAULT_COORDS } from "./constants";

/** Bridge file for MCP + extension (never commit). */
export function bridgeConfigPath(): string {
  return (
    process.env.RAPPI_CONFIG_PATH ||
    join(homedir(), ".config", "rappi-cursor", "config.json")
  );
}

export function loadConfigFromDisk(): RappiConfig {
  const path = bridgeConfigPath();
  if (!existsSync(path)) {
    throw new Error(
      "No hay sesión de Rappi. Inicia sesión con: Rappi: Iniciar sesión"
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const parsed = RappiConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid config: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function saveConfigToDisk(config: RappiConfig): void {
  const path = bridgeConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore on platforms without chmod */
  }
}

export function clearConfigOnDisk(): void {
  const path = bridgeConfigPath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function defaultCoordsFromEnv(): { lat: number; lng: number } {
  const lat = process.env.RAPPI_LAT
    ? parseFloat(process.env.RAPPI_LAT)
    : DEFAULT_COORDS.lat;
  const lng = process.env.RAPPI_LNG
    ? parseFloat(process.env.RAPPI_LNG)
    : DEFAULT_COORDS.lng;
  return { lat, lng };
}

/** Alias used by MCP (parity with upstream loadConfig). */
export async function loadConfig(): Promise<RappiConfig> {
  return loadConfigFromDisk();
}

export async function saveConfig(config: RappiConfig): Promise<void> {
  saveConfigToDisk(config);
}
