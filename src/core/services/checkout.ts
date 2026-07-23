import type { RappiConfig } from "../schemas/config";
import type { CheckoutDetail, CheckoutWidget } from "../schemas/checkout";
import { get, post, put } from "../http";

export async function getCheckoutDetail(
  storeType: string,
  config: RappiConfig
): Promise<CheckoutDetail> {
  return get<CheckoutDetail>(
    `/api/ms/shopping-cart/v1/${storeType}/checkout/detail`,
    config
  );
}

export async function getCheckoutWidgets(
  storeType: string,
  config: RappiConfig
): Promise<CheckoutWidget[]> {
  return post<CheckoutWidget[]>(
    `/api/ms/checkout-component/${storeType}`,
    {},
    config
  );
}

export async function setTip(
  storeType: string,
  tip: number,
  config: RappiConfig
): Promise<void> {
  await put<unknown>(
    `/api/ms/shopping-cart/v1/${storeType}/tip`,
    { tip },
    config
  );
}

export async function setPaymentMethod(
  storeType: string,
  paymentMethod: unknown,
  config: RappiConfig
): Promise<unknown> {
  return put<unknown>(
    `/api/ms/shopping-cart/v1/${storeType}/payment-method`,
    paymentMethod,
    config
  );
}
