export type ReportType = "overview" | "sales" | "purchases" | "product-sales" | "stock" | "profit" | "debts" | "party-ledger" | "financial" | "expenses" | "returns";
export type ReportGroup = "invoice" | "product";
export interface ReportFilters { type: ReportType; from?: string; to?: string; partyId?: string; productId?: string; warehouseId?: string; paymentAccountId?: string; movementType?: string; direction?: "in" | "out"; groupBy?: ReportGroup; sortBy?: "quantity" | "sales" | "name" | "profit"; debtSide?: "receivable" | "payable" | "clear"; search?: string; expenseType?: "once" | "recurring"; page: number; pageSize: number }
export interface ReportMeta { page: number; pageSize: number; totalRows: number; totalPages: number; accountTotals?: Array<{ account: string; incoming: number; outgoing: number; net: number }> }
export interface ReportResponse<Row = ReportRow> { report: ReportType; from: string | null; to: string | null; summary: Record<string, number | string | boolean>; rows: Row[]; meta: ReportMeta }
export interface ReportRow { id?: string; documentId?: string; partyId?: string; [key: string]: string | number | boolean | null | undefined }
export type SalesReportRow = ReportRow & { documentId: string; number: string; occurredAt: string; party: string; paymentMethod: string; total: number; cost: number; profit: number; margin: number; paid: number; due: number };
export type ProductSalesReportRow = ReportRow & { productId: string; sku: string; product: string; soldQuantity: number; returnedQuantity: number; netQuantity: number; sales: number; returns: number; netSales: number; averagePrice: number };
export type StockMovementReportRow = ReportRow & { occurredAt: string; sku: string; product: string; warehouse: string; movementType: string; before: number; change: number; after: number; documentNumber: string };

/** Reporting numbers never expose missing or non-finite values to the UI. */
export function reportNumber(value: unknown) {
  const numeric = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(numeric) ? 0 : numeric;
}
