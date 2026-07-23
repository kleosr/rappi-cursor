import type { RappiConfig } from "../schemas/config";
import type { StoreDetail, StoreCatalog } from "../schemas/store";
import { get, post } from "../http";

export async function getStoreDetail(
  storeId: number,
  config: RappiConfig
): Promise<StoreDetail> {
  return get<StoreDetail>(
    `/api/web-gateway/web/stores-router/id/${storeId}/`,
    config
  );
}

export async function getRestaurantCatalog(
  config: RappiConfig,
  options: {
    offset?: number;
    limit?: number;
    filters?: Record<string, unknown>;
  } = {}
): Promise<StoreCatalog> {
  return post<StoreCatalog>(
    "/api/restaurant-bus/stores/catalog-paged/home",
    {
      lat: config.lat,
      lng: config.lng,
      store_type: "restaurant",
      offset: options.offset ?? 0,
      limit: options.limit ?? 20,
      ...options.filters,
    },
    config
  );
}
