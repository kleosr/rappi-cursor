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

async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
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
  return parseJson<T>(res);
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
    let errorBody = "";
    try {
      errorBody = await res.text();
    } catch {
      /* ignore */
    }
    const details = errorBody ? ` (${errorBody.substring(0, 100)})` : "";
    throw new RappiHttpError(
      `POST ${path} → ${res.status} ${res.statusText}${details}`,
      res.status,
      path
    );
  }
  return parseJson<T>(res);
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
  return parseJson<T>(res);
}

export async function del<T>(path: string, config: RappiConfig): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: buildHeaders(config),
  });
  if (!res.ok) {
    throw new RappiHttpError(
      `DELETE ${path} → ${res.status} ${res.statusText}`,
      res.status,
      path
    );
  }
  return parseJson<T>(res);
}
