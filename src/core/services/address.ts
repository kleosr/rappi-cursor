import type { RappiConfig } from "../schemas/config";
import type { GeocodedAddress, UserAddress } from "../schemas/address";
import { get, put } from "../http";

export async function reverseGeocode(
  config: RappiConfig
): Promise<GeocodedAddress> {
  return get<GeocodedAddress>(
    `/api/ms/address/reverse-geocode?client=locationservices&lat=${config.lat}&lng=${config.lng}`,
    config
  );
}

export async function getAddresses(
  config: RappiConfig
): Promise<{ addresses: UserAddress[] }> {
  return get<{ addresses: UserAddress[] }>(
    "/api/ms/users-address/addresses",
    config
  );
}

export async function setActiveAddress(
  addressId: number,
  config: RappiConfig
): Promise<unknown> {
  return put<unknown>(
    `/api/ms/users-address/addresses/${addressId}/active`,
    {},
    config
  );
}
