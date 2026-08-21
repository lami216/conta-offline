import type { Product } from "./domain";

export type SaleDraftLine = {
  productId: string;
  quantity: string;
  piecePrice: string;
};

export function updateSaleDraftLine<T extends SaleDraftLine>(lines: T[], productId: string, patch: Partial<T>): T[] {
  return lines.map(line => line.productId === productId ? { ...line, ...patch } : line);
}

export function validateSaleDraft(lines: SaleDraftLine[], products: Product[], warehouseId?: string) {
  const errors: string[] = [];
  const invalidProductIds = new Set<string>();
  for (const line of lines) {
    const product = products.find(item => item.id === line.productId);
    if (!product) {
      errors.push("أحد المنتجات لم يعد متاحًا.");
      invalidProductIds.add(line.productId);
      continue;
    }
    const quantity = Number(line.quantity), price = Number(line.piecePrice);
    const available = Number(product.stocks?.[warehouseId ?? ""] ?? 0);
    if (line.quantity.trim() === "" || !Number.isFinite(quantity) || quantity <= 0) {
      errors.push(`${product.name}: الكمية غير صالحة ويجب أن تكون أكبر من صفر.`);
      invalidProductIds.add(product.id);
    } else if (quantity > available) {
      errors.push(`الكمية المطلوبة لمنتج «${product.name}» هي ${quantity} والمتوفر ${available} فقط.`);
      invalidProductIds.add(product.id);
    }
    if (line.piecePrice.trim() === "" || !Number.isFinite(price) || price <= 0) {
      errors.push(`${product.name}: سعر البيع غير صالح ويجب أن يكون أكبر من صفر.`);
      invalidProductIds.add(product.id);
    } else if (product.lastPurchaseCost != null && price < product.lastPurchaseCost) {
      errors.push(`سعر بيع «${product.name}» أقل من تكلفة الشراء ${product.lastPurchaseCost}.`);
      invalidProductIds.add(product.id);
    }
  }
  return { errors, invalidProductIds };
}
