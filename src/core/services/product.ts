import type { RappiConfig } from "../schemas/config";
import type { ProductToppings } from "../schemas/product";
import { get } from "../http";

export async function getProductToppings(
  storeId: number,
  productId: number,
  config: RappiConfig
): Promise<ProductToppings> {
  return get<ProductToppings>(
    `/api/web-gateway/web/restaurants-bus/products/toppings/${storeId}/${productId}/`,
    config
  );
}
