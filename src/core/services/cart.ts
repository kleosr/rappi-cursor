import type { RappiConfig } from "../schemas/config";
import type {
  CartStoreInput,
  CartResponse,
} from "../schemas/cart";
import { del, post, put } from "../http";

export async function addToCart(
  storeType: string,
  stores: CartStoreInput[],
  config: RappiConfig
): Promise<CartResponse> {
  const payload = stores.map((s) => ({
    id: s.id,
    place_at: s.place_at ?? "",
    delivery_method: s.delivery_method ?? "delivery",
    products: s.products.map((p) => ({
      id: p.id.includes("_") ? p.id : `${s.id}_${p.id}`,
      product_id: parseInt(p.id.includes("_") ? p.id.split("_")[1] : p.id),
      name: p.name,
      description: p.description || p.name,
      comment: p.comment ?? "",
      toppings: p.toppings.map((t) =>
        typeof t === "number"
          ? { id: t, description: "", units: 1, price: 0 }
          : { description: "", units: 1, price: 0, ...t }
      ),
      units: p.units,
      price: p.price ?? 0,
      real_price: p.real_price ?? p.price ?? 0,
      markup_price: p.price ?? 0,
      sale_type: p.sale_type || "U",
      sale_type_origin: p.sale_type_origin || "U",
      unit_type: p.unit_type || "U",
      category_id: p.category_id ?? 0,
      category_name: p.category_name ?? "",
      pum: p.pum ?? "0",
      is_sponsored: p.is_sponsored ?? false,
      ad_provider_metadata: p.ad_provider_metadata ?? "",
      in_stock: true,
    })),
  }));
  return put<CartResponse>(
    `/api/ms/shopping-cart/v2/${storeType}/store`,
    payload,
    config
  );
}

export async function getCarts(config: RappiConfig): Promise<CartResponse[]> {
  return post<CartResponse[]>(
    "/api/ms/shopping-cart/v1/all/get",
    {},
    config
  );
}

export async function resolveStoreType(
  storeType: string,
  config: RappiConfig
): Promise<string> {
  const carts = await getCarts(config);
  const cart =
    carts.find((c) => c.store_type === storeType) ||
    carts.find((c) => c.store_type_origin === storeType);
  return cart?.store_type_origin || cart?.store_type || storeType;
}

/** API path segment for cart mutations (prefer origin when Rappi remaps types). */
export function apiStoreType(cart: CartResponse): string {
  return cart.store_type_origin || cart.store_type;
}

export function findCartForProduct(
  carts: CartResponse[],
  productId: string
): CartResponse | undefined {
  return carts.find((c) =>
    c.stores.some((s) => s.products.some((p) => p.id === productId))
  );
}

/** First non-empty cart's API store type, else DEFAULT restaurant. */
export async function primaryCartStoreType(
  config: RappiConfig,
  fallback = "restaurant"
): Promise<string> {
  const carts = await getCarts(config);
  const cart = carts.find((c) => c.stores?.some((s) => s.products?.length));
  return cart ? apiStoreType(cart) : fallback;
}

export async function removeFromCart(
  _storeTypeHint: string | undefined,
  productId: string,
  config: RappiConfig
): Promise<unknown> {
  const carts = await getCarts(config);
  const cart = findCartForProduct(carts, productId);
  if (!cart) {
    throw new Error(
      `Product "${productId}" not found in cart. Run get_cart / refresh Cart and use the compound id shown there.`
    );
  }
  const apiType = apiStoreType(cart);
  return del(
    `/api/ms/shopping-cart/v2/${apiType}/product/${encodeURIComponent(productId)}`,
    config
  );
}

export async function assertCartPlaceable(
  storeType: string,
  config: RappiConfig
): Promise<CartResponse> {
  const cart = await recalculateCart(storeType, config);
  if (!cart.stores?.length) {
    throw new Error("Cart is empty");
  }
  const invalid = cart.stores.filter((s) => !s.valid);
  if (invalid.length) {
    const reasons = invalid
      .map(
        (s) =>
          `${s.name}: ${s.is_open ? "products unavailable" : "store is closed"}`
      )
      .join("; ");
    throw new Error(`Cannot place order: ${reasons}`);
  }
  return cart;
}

export async function recalculateCart(
  storeType: string,
  config: RappiConfig
): Promise<CartResponse> {
  return post<CartResponse>(
    `/api/ms/shopping-cart/v1/${storeType}/recalculate`,
    {},
    config
  );
}
