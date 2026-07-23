import type { RappiConfig } from "./schemas/config";
import { BASE_URL, DEFAULT_HEADERS } from "./constants";

export class RappiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string
  ) {
    super(message);
    this.name = "RappiHttpError";
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

function buildHeaders(config: RappiConfig): Record<string, string> {
  return {
    ...DEFAULT_HEADERS,
    authorization: `Bearer ${config.token}`,
    deviceid: config.deviceId,
  };
}

async function parseJsonBody<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

async function errorSnippet(res: Response): Promise<string> {
  try {
    const errorBody = await res.text();
    return errorBody ? ` (${errorBody.substring(0, 100)})` : "";
  } catch {
    return "";
  }
}

export async function get<T>(path: string, config: RappiConfig): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new RappiHttpError(
      `GET ${path} → ${res.status} ${res.statusText}`,
      res.status,
      path
    );
  }
  return parseJsonBody<T>(res);
}

export async function post<T>(
  path: string,
  body: unknown,
  config: RappiConfig
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { ...buildHeaders(config), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const details = await errorSnippet(res);
    throw new RappiHttpError(
      `POST ${path} → ${res.status} ${res.statusText}${details}`,
      res.status,
      path
    );
  }
  return parseJsonBody<T>(res);
}

export async function put<T>(
  path: string,
  body: unknown,
  config: RappiConfig
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers: { ...buildHeaders(config), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new RappiHttpError(
      `PUT ${path} → ${res.status} ${res.statusText}`,
      res.status,
      path
    );
  }
  return parseJsonBody<T>(res);
}

export async function del<T>(path: string, config: RappiConfig): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    const details = await errorSnippet(res);
    throw new RappiHttpError(
      `DELETE ${path} → ${res.status} ${res.statusText}${details}`,
      res.status,
      path
    );
  }
  return parseJsonBody<T>(res);
}
