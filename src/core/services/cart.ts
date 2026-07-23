import type { RappiConfig } from "../schemas/config";
import type {
  CartStoreInput,
  CartResponse,
  CartProductResponse,
} from "../schemas/cart";
import { del, post, put, RappiHttpError } from "../http";

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

/** Match compound id, bare suffix, or passthrough product_id. */
export function productMatchesId(
  product: CartProductResponse,
  productId: string
): boolean {
  if (product.id === productId) return true;
  if (product.id.endsWith(`_${productId}`)) return true;
  if (productId.endsWith(`_${product.id}`)) return true;
  const raw = (product as { product_id?: unknown }).product_id;
  if (raw == null) return false;
  const pid = String(raw);
  return pid === productId || productId.endsWith(`_${pid}`);
}

function listCartProductIds(carts: CartResponse[]): string[] {
  const ids: string[] = [];
  for (const c of carts) {
    for (const s of c.stores ?? []) {
      for (const p of s.products ?? []) {
        if (p.id) ids.push(p.id);
      }
    }
  }
  return ids;
}

export function findCartForProduct(
  carts: CartResponse[],
  productId: string
): CartResponse | undefined {
  return carts.find((c) =>
    c.stores.some((s) => s.products.some((p) => productMatchesId(p, productId)))
  );
}

export function resolveCartProductId(
  cart: CartResponse,
  productId: string
): string {
  for (const s of cart.stores ?? []) {
    for (const p of s.products ?? []) {
      if (productMatchesId(p, productId)) return p.id;
    }
  }
  return productId;
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
    const ids = listCartProductIds(carts);
    const listed = ids.length ? ids.join(", ") : "(cart empty)";
    throw new Error(
      `Product "${productId}" not found in cart. Available ids: ${listed}`
    );
  }

  const resolvedId = resolveCartProductId(cart, productId);
  const primary = cart.store_type;
  const origin = cart.store_type_origin;
  const types = [primary];
  if (origin && origin !== primary) types.push(origin);

  let lastError: unknown;
  for (let i = 0; i < types.length; i++) {
    const storeType = types[i];
    try {
      // Path must use the raw compound id (no URI encoding).
      return await del(
        `/api/ms/shopping-cart/v2/${storeType}/product/${resolvedId}`,
        config
      );
    } catch (err) {
      lastError = err;
      const is404 =
        err instanceof RappiHttpError && err.status === 404;
      if (is404 && i < types.length - 1) continue;
      throw err;
    }
  }
  throw lastError;
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
