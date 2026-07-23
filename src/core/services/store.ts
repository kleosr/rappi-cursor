import type { RappiConfig } from "../schemas/config";
import type { StoreDetail, StoreCatalog } from "../schemas/store";
import { get, post } from "../http";

type MenuResponse = {
  corridors?: StoreDetail["corridors"];
  scheduled_orders?: unknown;
};

export async function getStoreMenu(
  storeId: number,
  config: RappiConfig
): Promise<MenuResponse> {
  return get<MenuResponse>(
    `/api/restaurant-bus/store/${storeId}/menu`,
    config
  );
}

export async function getStoreDetail(
  storeId: number,
  config: RappiConfig
): Promise<StoreDetail> {
  const [store, menu] = await Promise.all([
    get<StoreDetail>(`/api/web-gateway/web/stores-router/id/${storeId}/`, config),
    getStoreMenu(storeId, config).catch(() => ({ corridors: undefined })),
  ]);
  if (!store.corridors?.length && menu.corridors?.length) {
    store.corridors = menu.corridors;
  }
  return store;
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
