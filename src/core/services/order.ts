import type { RappiConfig } from "../schemas/config";
import type { OrdersResponse } from "../schemas/order";
import { get, post } from "../http";
import { getCheckoutDetail } from "./checkout";

export async function placeOrder(
  storeType: string,
  config: RappiConfig
): Promise<unknown> {
  const checkoutDetail = await getCheckoutDetail(storeType, config);

  return post<unknown>(
    `/api/ms/shopping-cart-proxy/${storeType}/checkout`,
    {
      return_key: checkoutDetail.return_key,
    },
    config
  );
}

export async function getOrders(
  config: RappiConfig
): Promise<OrdersResponse> {
  return get<OrdersResponse>("/api/user-order-home/orders", config);
}
