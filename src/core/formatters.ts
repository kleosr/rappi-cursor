import { IMAGES_BASE_URL } from "./constants";

export function formatPrice(amount: number): string {
  return `$${amount.toLocaleString("es-CO")}`;
}

export function imageUrl(path: string, prefix = "products"): string {
  if (path.startsWith("http")) return path;
  return `${IMAGES_BASE_URL}/${prefix}/${path}`;
}
