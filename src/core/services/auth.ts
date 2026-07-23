import type { RappiConfig } from "../schemas/config";
import type { RappiUser } from "../schemas/auth";
import { get } from "../http";

export async function getUser(config: RappiConfig): Promise<RappiUser> {
  return get<RappiUser>("/ms/application-user/auth", config);
}

export async function isPrime(config: RappiConfig): Promise<boolean> {
  const data = await get<{ is_prime: boolean }>(
    "/api/ms/rappi-prime/is-prime",
    config
  );
  return data.is_prime;
}
