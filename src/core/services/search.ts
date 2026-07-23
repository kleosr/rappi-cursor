import type { RappiConfig } from "../schemas/config";
import type { SearchResult } from "../schemas/search";
import { post } from "../http";

export async function search(
  query: string,
  config: RappiConfig
): Promise<SearchResult> {
  return post<SearchResult>(
    "/api/pns-global-search-api/v1/unified-search?is_prime=false",
    { query, lat: config.lat, lng: config.lng },
    config
  );
}
