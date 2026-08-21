import type { ClientSession, Db } from "mongodb";
import { getMongo, getMongoClient } from "../../../lib/mongodb.ts";
import { log } from "../../../lib/log.ts";
import { sessionFromRequest, validSameOrigin } from "../../../lib/auth.ts";

type Input = Record<string, unknown>;
type Line = { productId: string; quantity: number; description?: string; piecePrice?: number; unitPrice?: number; actualQuantity?: number; purchaseCost?: number | null; costAtSale?: number | null; grossProfit?: number | null };
type WarehouseDoc = { _id: string; name: string; isSalesDefault?: boolean; [key: string]: unknown };
const warehouses = (db: Db) => db.collection<WarehouseDoc>("warehouses");
class CommandError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const num = (v: unknown) => typeof v === "number" ? v : Number(v);
const positive = (v: unknown, label: string, allowZero = false) => {
  const n = num(v); if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) throw new CommandError(`${label} غير صالح`); return n;
};
const optionalNumber = (v: unknown, label: string, integer = false) => {
  if (v === "" || v == null) return null;
  const n = positive(v, label, true);
  if (integer && (!Number.isInteger(n) || n <= 0)) throw new CommandError(`${label} غير صالح`);
  return n;
};
async function nextProductCode(db: Db, session: ClientSession) {
  const counters = db.collection<{ _id: string; value: number; createdAt?: Date; updatedAt?: Date }>("counters");
  const legacy = await db.collection("products").find(
    { sku: { $type: "string", $regex: /^\d{1,6}$/ } }, { session, projection: { sku: 1 } },
  ).toArray();
  const highest = legacy.reduce((value, product) => Math.max(value, Number(product.sku)), 0);
  await counters.updateOne(
    { _id: "productSequence" }, { $max: { value: highest }, $setOnInsert: { createdAt: new Date() } }, { upsert: true, session },
  );
  const counter = await counters.findOneAndUpdate(
    { _id: "productSequence" }, { $inc: { value: 1 }, $set: { updatedAt: new Date() } }, { returnDocument: "after", session },
  );
  if (!counter) throw new CommandError("تعذر توليد رمز المنتج", 409);
  return String(counter.value);
}
const lines = (body: Input): Line[] => {
  if (!Array.isArray(body.lines) || !body.lines.length) throw new CommandError("يجب إضافة منتج واحد على الأقل");
  const seen = new Set<string>();
  return body.lines.map((raw) => {
    const r = raw as Input, productId = text(r.productId), quantity = positive(r.quantity, "الكمية");
    if (!productId || seen.has(productId)) throw new CommandError("المنتجات غير صالحة أو مكررة"); seen.add(productId);
    return { productId, quantity, piecePrice: num(r.piecePrice), unitPrice: num(r.unitPrice), actualQuantity: num(r.actualQuantity) };
  });
};
const baseDocument = (kind: string, prefix: string) => ({
  id: id(kind), number: `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`, kind, status: "posted", occurredAt: new Date().toISOString(),
});
async function paymentAccount(db: Db, session: ClientSession, value: unknown, active = true) {
  const key = text(value);
  const account = await db.collection("paymentAccounts").findOne({ $or: [{ id: key }, { code: key }], ...(active ? { isActive: true } : {}) }, { session });
  if (!account) throw new CommandError("يجب اختيار وسيلة دفع صالحة");
  return account;
}
async function financialMovement(db: Db, session: ClientSession, document: Record<string, unknown>, direction: "in" | "out", amount: number, type: string, { allowNegative = false } = {}) {
  if (!amount) return;
  const account = await paymentAccount(db, session, document.paymentMethod);
  const delta = direction === "in" ? amount : -amount;
  const result = await db.collection("paymentAccounts").updateOne(
    { id: account.id, ...(direction === "out" && !allowNegative ? { balance: { $gte: amount } } : {}) },
    { $inc: { balance: delta } }, { session },
  );
  if (!result.matchedCount) throw new CommandError(`الرصيد غير كافٍ في ${account.name}`);
  await db.collection("financialMovements").insertOne({ id: id("fin"), paymentMethod: account.id, paymentCode: account.code, direction, amount, documentId: document.id, documentNumber: document.number, partyId: document.partyId ?? null, partyName: document.partyName ?? null, type, occurredAt: document.occurredAt, transferId: document.transferId ?? null, note: document.note ?? null }, { session });
}
async function authoritativeCost(db: Db, session: ClientSession, product: Record<string, unknown>) {
  if (Number.isFinite(product.lastPurchaseCost)) return Number(product.lastPurchaseCost);
  const latest = await db.collection("documents").findOne({ kind: "purchase", status: "posted", "lines.productId": product.id }, { session, sort: { occurredAt: -1 }, projection: { lines: 1, occurredAt: 1 } });
  const line = (latest?.lines as Line[] | undefined)?.find(item => item.productId === product.id);
  if (!line || !Number.isFinite(Number(line.unitPrice))) return null;
  const cost = Number(line.unitPrice);
  await db.collection("products").updateOne({ id: product.id, lastPurchaseCost: { $exists: false } }, { $set: { lastPurchaseCost: cost, lastPurchaseAt: latest?.occurredAt } }, { session });
  product.lastPurchaseCost = cost;
  return cost;
}
async function refs(db: Db, session: ClientSession, body: Input, requireParty = false) {
  const warehouseId = text(body.warehouseId), partyId = text(body.partyId);
  const [warehouse, party] = await Promise.all([
    warehouseId ? warehouses(db).findOne({ _id: warehouseId }, { session }) : null,
    partyId ? db.collection("parties").findOne({ id: partyId }, { session }) : null,
  ]);
  if (!warehouse) throw new CommandError("المخزن غير موجود", 404);
  if (requireParty && !party) throw new CommandError("الطرف غير موجود", 404);
  return { warehouse, party, warehouseId, partyId };
}
async function products(db: Db, session: ClientSession, input: Line[]) {
  const found = await db.collection("products").find({ id: { $in: input.map(x => x.productId) }, isArchived: { $ne: true } }, { session }).toArray();
  if (found.length !== input.length) throw new CommandError("أحد المنتجات غير موجود", 404);
  return new Map(found.map(p => [p.id as string, p]));
}
async function changeStock(db: Db, session: ClientSession, product: Record<string, unknown>, warehouse: Record<string, unknown>, delta: number, document: Record<string, unknown>, type: string) {
  const warehouseId = String(warehouse._id), productId = String(product.id), before = Number((product.stocks as Record<string, number> | undefined)?.[warehouseId] ?? 0), after = before + delta;
  if (after < 0) throw new CommandError(`المخزون غير كافٍ للمنتج ${product.name}`);
  const stockPath = `stocks.${warehouseId}`;
  const stockMatch = before === 0 ? { $or: [{ [stockPath]: 0 }, { [stockPath]: { $exists: false } }] } : { [stockPath]: before };
  const result = await db.collection("products").updateOne({ id: productId, ...stockMatch }, { $set: { [stockPath]: after } }, { session });
  if (!result.matchedCount) throw new CommandError("تغير المخزون أثناء العملية، أعد المحاولة", 409);
  const currentStocks = (product.stocks ??= {}) as Record<string, number>;
  currentStocks[warehouseId] = after;
  await db.collection("stockMovements").insertOne({ id: id("mov"), documentId: document.id, documentNumber: document.number, warehouseId, warehouseName: warehouse.name, productId, productName: product.name, type, quantityDelta: delta, balanceBefore: before, balanceAfter: after, occurredAt: document.occurredAt }, { session });
  return { before, after };
}

export async function execute(db: Db, session: ClientSession, body: Input) {
  const type = text(body.type);
  if (type === "product.delete") {
    const productId = text(body.id), product = await db.collection("products").findOne({ id: productId }, { session });
    if (!product) throw new CommandError("المنتج غير موجود", 404);
    const totalStock = Object.values((product.stocks ?? {}) as Record<string, unknown>).reduce<number>((sum, value) => sum + Number(value || 0), 0);
    if (totalStock > 0) throw new CommandError("لا يمكن حذف المنتج ولديه مخزون. صفّر المخزون أولًا من تصحيح المخزون.", 409);
    const [document, movement] = await Promise.all([
      db.collection("documents").findOne({ "lines.productId": productId }, { session, projection: { _id: 1 } }),
      db.collection("stockMovements").findOne({ productId }, { session, projection: { _id: 1 } }),
    ]);
    if (document || movement) await db.collection("products").updateOne({ id: productId }, { $set: { isArchived: true, archivedAt: new Date() } }, { session });
    else await db.collection("products").deleteOne({ id: productId }, { session });
    return productId;
  }
  if (type === "party.create") {
    const name = text(body.name), phone = text(body.phone); if (!name) throw new CommandError("اسم الطرف مطلوب");
    if (phone) { const existing = await db.collection("parties").findOne({ phone }, { session }); if (existing) return String(existing.id); }
    const party = { id: id("party"), name, phone, roles: ["customer", "supplier"], receivable: 0, payable: 0, net: 0, createdAt: new Date() };
    await db.collection("parties").insertOne(party, { session }); return party.id;
  }
  if (type === "warehouse.create") {
    const name = text(body.name); if (!name) throw new CommandError("اسم المخزن مطلوب"); const _id = id("wh");
    await warehouses(db).insertOne({ _id, name, isSalesDefault: false, createdAt: new Date() }, { session }); return _id;
  }
  if (type === "warehouse.update") { const name = text(body.name), warehouseId = text(body.id); if (!name) throw new CommandError("اسم المخزن مطلوب"); const r = await warehouses(db).updateOne({ _id: warehouseId }, { $set: { name } }, { session }); if (!r.matchedCount) throw new CommandError("المخزن غير موجود", 404); return warehouseId; }
  if (type === "warehouse.default") { const warehouseId = text(body.warehouseId); if (!await warehouses(db).findOne({ _id: warehouseId }, { session })) throw new CommandError("المخزن غير موجود", 404); await warehouses(db).updateMany({}, { $set: { isSalesDefault: false } }, { session }); await warehouses(db).updateOne({ _id: warehouseId }, { $set: { isSalesDefault: true } }, { session }); return warehouseId; }
  if (type === "product.create" || type === "product.update") {
    const name = text(body.name), barcode = text(body.barcode);
    if (!name) throw new CommandError("اسم المنتج مطلوب");
    const productId = text(body.id);
    if (barcode && await db.collection("products").findOne({ barcode, ...(type === "product.update" ? { id: { $ne: productId } } : {}) }, { session })) throw new CommandError("هذا الباركود مستخدم لمنتج آخر", 409);
    const pieceCost = optionalNumber(body.pieceCost, "سعر الشراء"), values = { name, barcode, pieceCost, piecePrice: optionalNumber(body.piecePrice, "سعر البيع") };
    if (type === "product.create") {
      const openingStock = optionalNumber(body.openingStock, "رصيد البداية") ?? 0;
      if (!Number.isInteger(openingStock)) throw new CommandError("رصيد البداية غير صالح");
      if (openingStock > 0 && (!pieceCost || pieceCost <= 0)) throw new CommandError("سعر الشراء للفرد مطلوب عند إدخال رصيد بداية");
      let warehouse = null;
      if (openingStock > 0) {
        warehouse = await warehouses(db).findOne({ isSalesDefault: true }, { session }) ?? await warehouses(db).findOne({ _id: text(body.openingWarehouseId) }, { session });
        if (!warehouse) throw new CommandError("مخزن رصيد البداية مطلوب");
      }
      const sku = await nextProductCode(db, session), now = new Date(), product = { id: id("product"), sku, ...values, ...(openingStock > 0 ? { lastPurchaseCost: pieceCost, lastPurchaseAt: now.toISOString() } : {}), stocks: {}, createdAt: now };
      await db.collection("products").insertOne(product, { session });
      if (openingStock > 0 && warehouse) {
        const doc = { ...baseDocument("adjustment", "OPEN"), partyId: null, partyName: null, warehouseId: warehouse._id, warehouseName: warehouse.name, destinationWarehouseId: null, destinationWarehouseName: null, parentDocumentId: null, paymentMethod: null, title: "رصيد بداية", total: 0, dueTotal: 0, paidTotal: 0, lines: [{ id: id("line"), productId: product.id, description: name, quantity: openingStock, unitPrice: pieceCost, lineTotal: 0 }] };
        await changeStock(db, session, product, warehouse, openingStock, doc, "opening");
        await db.collection("documents").insertOne(doc, { session });
      }
      return product.id;
    }
    const r = await db.collection("products").updateOne({ id: productId }, { $set: values }, { session }); if (!r.matchedCount) throw new CommandError("المنتج غير موجود", 404); return productId;
  }
  if (type === "sale.post" || type === "purchase.post") {
    const input = lines(body), isSale = type === "sale.post", { warehouse, party, warehouseId, partyId } = await refs(db, session, body, !isSale || text(body.paymentMethod) === "note"), map = await products(db, session, input), paymentMethod = text(body.paymentMethod) || "cash";
    if (paymentMethod !== "note") await paymentAccount(db, session, paymentMethod);
    const costs = isSale ? new Map(await Promise.all(input.map(async line => [line.productId, await authoritativeCost(db, session, map.get(line.productId)!)] as const))) : new Map<string, number | null>();
    const calculated = input.map(line => { const p = map.get(line.productId)!; let unitPrice: number, total: number; if (isSale) { const price = positive(line.piecePrice, "سعر الفرد"); const cost = costs.get(line.productId); if (cost != null && price < cost) throw new CommandError(`لا يمكن البيع تحت سعر الشراء. سعر الشراء الحالي: ${cost} MRU`); total = Math.round(line.quantity * price); unitPrice = price; } else { unitPrice = positive(line.unitPrice, "سعر الشراء"); total = Math.round(unitPrice * line.quantity); } return { id: id("line"), productId: line.productId, description: p.name, quantity: line.quantity, unitPrice, lineTotal: total, ...(isSale ? { costAtSale: costs.get(line.productId) ?? null, grossProfit: costs.get(line.productId) == null ? null : total - line.quantity * Number(costs.get(line.productId)) } : {}) }; });
    const total = calculated.reduce((s, l) => s + l.lineTotal, 0), requestedPaid = paymentMethod === "note" ? 0 : total; const due = total - requestedPaid;
    if (due > 0 && !party) throw new CommandError("يجب اختيار طرف عند وجود مبلغ مستحق");
    const businessDate = new Date().toISOString().slice(0, 10);
    const dailySequence = isSale ? (Number((await db.collection("documents").find({ kind: "sale", businessDate }, { session }).sort({ dailySequence: -1 }).limit(1).next())?.dailySequence ?? 0) + 1) : undefined;
    const doc = { ...baseDocument(isSale ? "sale" : "purchase", isSale ? "SAL" : "PUR"), businessDate, ...(isSale ? { dailySequence } : {}), partyId: partyId || null, partyName: party?.name ?? null, warehouseId, warehouseName: warehouse.name, destinationWarehouseId: null, destinationWarehouseName: null, parentDocumentId: null, paymentMethod, title: null, total, dueTotal: due, paidTotal: requestedPaid, lines: calculated };
    for (const line of input) await changeStock(db, session, map.get(line.productId)!, warehouse, isSale ? -line.quantity : line.quantity, doc, isSale ? "sale" : "purchase");
    await db.collection("documents").insertOne(doc, { session });
    if (!isSale) for (const line of calculated) await db.collection("products").updateOne({ id: line.productId }, { $set: { lastPurchaseCost: line.unitPrice, lastPurchaseAt: doc.occurredAt } }, { session });
    if (due) await db.collection("parties").updateOne({ id: partyId }, { $inc: isSale ? { receivable: due, net: due } : { payable: due, net: -due } }, { session });
    if (requestedPaid) await financialMovement(db, session, doc, isSale ? "in" : "out", requestedPaid, isSale ? "sale" : "purchase", { allowNegative: !isSale });
    return doc.id;
  }
  if (type === "transfer.post") {
    const input = lines(body), fromId = text(body.fromWarehouseId), toId = text(body.toWarehouseId); if (!fromId || fromId === toId) throw new CommandError("اختر مخزنين مختلفين");
    const [from, to] = await Promise.all([warehouses(db).findOne({ _id: fromId }, { session }), warehouses(db).findOne({ _id: toId }, { session })]); if (!from || !to) throw new CommandError("أحد المخازن غير موجود", 404); const map = await products(db, session, input), doc = { ...baseDocument("transfer", "TRF"), partyId: null, partyName: null, warehouseId: fromId, warehouseName: from.name, destinationWarehouseId: toId, destinationWarehouseName: to.name, parentDocumentId: null, paymentMethod: null, title: null, total: 0, dueTotal: 0, paidTotal: 0, lines: input.map(l => ({ id: id("line"), productId: l.productId, description: map.get(l.productId)!.name, quantity: l.quantity, unitPrice: 0, lineTotal: 0 })) };
    for (const line of input) { const p = map.get(line.productId)!; await changeStock(db, session, p, from, -line.quantity, doc, "transfer-out"); await changeStock(db, session, p, to, line.quantity, doc, "transfer-in"); } await db.collection("documents").insertOne(doc, { session }); return doc.id;
  }
  if (type === "adjustment.post") {
    if (!Array.isArray(body.lines) || !body.lines.length) throw new CommandError("أضف منتجًا"); const input = body.lines.map(raw => { const r = raw as Input; return { productId: text(r.productId), quantity: 1, actualQuantity: positive(r.actualQuantity, "الرصيد الفعلي", true), purchaseCost: r.purchaseCost == null || r.purchaseCost === "" ? null : positive(r.purchaseCost, "تكلفة الشراء") }; }); const { warehouse, warehouseId } = await refs(db, session, body), map = await products(db, session, input), reason = text(body.reason); if (!reason) throw new CommandError("سبب التصحيح مطلوب");
    for (const line of input) {
      const product = map.get(line.productId)!, before = Number((product.stocks as Record<string, number> | undefined)?.[warehouseId] ?? 0);
      if (line.actualQuantity! > before && await authoritativeCost(db, session, product) == null && line.purchaseCost == null) throw new CommandError(`تكلفة الشراء مطلوبة لإضافة مخزون المنتج ${product.name}`);
    }
    const doc = { ...baseDocument("adjustment", "ADJ"), partyId: null, partyName: null, warehouseId, warehouseName: warehouse.name, destinationWarehouseId: null, destinationWarehouseName: null, parentDocumentId: null, paymentMethod: null, title: reason, total: 0, dueTotal: 0, paidTotal: 0, lines: [] as Record<string, unknown>[] };
    for (const line of input) { const p = map.get(line.productId)!, before = Number((p.stocks as Record<string, number> | undefined)?.[warehouseId] ?? 0), after = line.actualQuantity!; if (after > before && p.lastPurchaseCost == null && line.purchaseCost != null) { await db.collection("products").updateOne({ id: p.id }, { $set: { lastPurchaseCost: line.purchaseCost, lastPurchaseAt: doc.occurredAt } }, { session }); p.lastPurchaseCost = line.purchaseCost; } await changeStock(db, session, p, warehouse, after - before, doc, "adjustment"); doc.lines.push({ id: id("line"), productId: line.productId, description: `${p.name} — ${reason} (قبل ${before}، بعد ${after})`, quantity: after - before, unitPrice: Number(p.lastPurchaseCost ?? 0), lineTotal: 0, balanceBefore: before, balanceAfter: after }); } await db.collection("documents").insertOne(doc, { session }); return doc.id;
  }
  if (type === "sale.return") {
    const input = lines(body), saleId = text(body.saleId), sale = await db.collection("documents").findOne({ id: saleId, kind: "sale", status: "posted" }, { session }); if (!sale) throw new CommandError("فاتورة البيع غير موجودة", 404); const prior = await db.collection("documents").find({ parentDocumentId: saleId, kind: "return" }, { session }).toArray(), returned = new Map<string, number>(); for (const d of prior) for (const l of d.lines as Line[]) returned.set(l.productId, (returned.get(l.productId) ?? 0) + l.quantity); const saleLines = new Map((sale.lines as Line[]).map(l => [l.productId, l])); const map = await products(db, session, input), warehouse = await warehouses(db).findOne({ _id: String(sale.warehouseId) }, { session }); if (!warehouse) throw new CommandError("مخزن الفاتورة غير موجود");
    const calculated = input.map(l => { const original = saleLines.get(l.productId); if (!original || l.quantity + (returned.get(l.productId) ?? 0) > original.quantity) throw new CommandError("كمية الإرجاع تتجاوز الكمية القابلة للإرجاع"); const lineTotal = Math.round(l.quantity * Number(original.unitPrice)), cost = original.costAtSale ?? null; return { id: id("line"), productId: l.productId, description: original.description, quantity: l.quantity, unitPrice: original.unitPrice, lineTotal, costAtSale: cost, grossProfit: cost == null ? null : lineTotal - l.quantity * cost }; }); const total = calculated.reduce((s, l) => s + l.lineTotal, 0), priorDueCredits = prior.reduce((sum, d) => sum + Math.max(0, Number(d.total) - Number(d.paidTotal)), 0), priorRefunds = prior.reduce((sum, d) => sum + Number(d.paidTotal), 0), dueCredit = Math.min(total, Math.max(0, Number(sale.dueTotal) - priorDueCredits)), refund = Math.min(total - dueCredit, Math.max(0, Number(sale.paidTotal) - priorRefunds)), doc = { ...baseDocument("return", "RET"), partyId: sale.partyId, partyName: sale.partyName, warehouseId: sale.warehouseId, warehouseName: sale.warehouseName, destinationWarehouseId: null, destinationWarehouseName: null, parentDocumentId: saleId, paymentMethod: sale.paymentMethod, title: null, total, dueTotal: total - dueCredit - refund, paidTotal: refund, lines: calculated };
    for (const line of input) await changeStock(db, session, map.get(line.productId)!, warehouse, line.quantity, doc, "sale-return"); await db.collection("documents").insertOne(doc, { session }); if (dueCredit && sale.partyId) await db.collection("parties").updateOne({ id: sale.partyId }, { $inc: { receivable: -dueCredit, net: -dueCredit } }, { session }); return doc.id;
  }
  if (["payment.post", "settlement.post", "offset.post"].includes(type)) {
    const partyId = text(body.partyId), party = await db.collection("parties").findOne({ id: partyId }, { session }); if (!party) throw new CommandError("الطرف غير موجود", 404); const requested = positive(body.amount, "المبلغ"); let receivable = Number(party.receivable), payable = Number(party.payable); const side = text(body.side); if (type === "offset.post") { const amount = Math.min(requested, receivable, payable); if (amount <= 0 || requested > amount) throw new CommandError("المقاصة تتجاوز الرصيد المشترك"); receivable -= amount; payable -= amount; } else if (side === "receivable") { if (requested > receivable) throw new CommandError("المبلغ يتجاوز المستحق"); receivable -= requested; } else { if (requested > payable) throw new CommandError("المبلغ يتجاوز المستحق"); payable -= requested; }
    const kind = type.split(".")[0], method = type === "offset.post" || type === "settlement.post" ? null : text(body.paymentMethod); if (type === "payment.post") await paymentAccount(db, session, method); const doc = { ...baseDocument(kind, kind === "offset" ? "OFF" : kind === "payment" ? "PAY" : "SET"), partyId, partyName: party.name, warehouseId: null, warehouseName: null, destinationWarehouseId: null, destinationWarehouseName: null, parentDocumentId: null, paymentMethod: method, title: side === "receivable" ? "الطرف دفع لنا" : "نحن دفعنا للطرف", total: requested, dueTotal: 0, paidTotal: requested, lines: [] }; await db.collection("parties").updateOne({ id: partyId }, { $set: { receivable, payable, net: receivable - payable } }, { session }); await db.collection("documents").insertOne(doc, { session }); if (type === "payment.post") await financialMovement(db, session, doc, side === "receivable" ? "in" : "out", requested, side === "receivable" ? "party-receipt" : "party-payment"); return doc.id;
  }
  if (type === "expense.post") { const title = text(body.title), amount = positive(body.amount, "المبلغ"), occurredAt = text(body.occurredAt), frequency = text(body.frequency); if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) throw new CommandError("العنوان والتاريخ مطلوبان"); if (["daily", "monthly"].includes(frequency)) { const recurring = { id: id("rec"), title, amount, frequency, startsOn: occurredAt, active: true, createdAt: new Date() }; await db.collection("recurringExpenses").insertOne(recurring, { session }); return recurring.id; } const method = text(body.paymentMethod); await paymentAccount(db, session, method); const doc = { ...baseDocument("expense", "EXP"), occurredAt: new Date(`${occurredAt}T12:00:00Z`).toISOString(), partyId: null, partyName: null, warehouseId: null, warehouseName: null, destinationWarehouseId: null, destinationWarehouseName: null, parentDocumentId: null, paymentMethod: method, title, total: amount, dueTotal: 0, paidTotal: amount, lines: [{ id: id("line"), productId: null, description: title, quantity: 1, unitPrice: amount, lineTotal: amount }] }; await financialMovement(db, session, doc, "out", amount, "expense"); await db.collection("documents").insertOne(doc, { session }); return doc.id; }
  if (type === "expense.materialize") { const recurringId = text(body.recurringId), dueDate = text(body.dueDate), method = text(body.paymentMethod), recurring = await db.collection("recurringExpenses").findOne({ id: recurringId, active: true }, { session }); if (!recurring) throw new CommandError("المصروف المتكرر غير موجود", 404); await paymentAccount(db, session, method); const occurrenceKey = recurring.frequency === "monthly" ? dueDate.slice(0, 7) : dueDate; const existing = await db.collection("documents").findOne({ recurringId, occurrenceKey }, { session }); if (existing) throw new CommandError("تم تسجيل دفع هذا الاستحقاق مسبقًا", 409); const doc = { ...baseDocument("expense", "EXP"), occurredAt: new Date(`${dueDate}T12:00:00Z`).toISOString(), recurringId, dueDate, occurrenceKey, partyId: null, partyName: null, warehouseId: null, warehouseName: null, destinationWarehouseId: null, destinationWarehouseName: null, parentDocumentId: null, paymentMethod: method, title: recurring.title, total: recurring.amount, dueTotal: 0, paidTotal: recurring.amount, lines: [{ id: id("line"), productId: null, description: recurring.title, quantity: 1, unitPrice: recurring.amount, lineTotal: recurring.amount }] }; await financialMovement(db, session, doc, "out", Number(recurring.amount), "expense"); await db.collection("documents").insertOne(doc, { session }); return doc.id; }
  if (type === "payment-account.update") { const accountId = text(body.id), name = text(body.name), color = text(body.color); if (!name || !/^#[0-9a-f]{6}$/i.test(color)) throw new CommandError("بيانات وسيلة الدفع غير صالحة"); const result = await db.collection("paymentAccounts").updateOne({ id: accountId }, { $set: { name, color, isActive: body.isActive !== false, updatedAt: new Date() } }, { session }); if (!result.matchedCount) throw new CommandError("وسيلة الدفع غير موجودة", 404); return accountId; }
  if (type === "payment-account.create") { const name = text(body.name), color = text(body.color); if (!name || !/^#[0-9a-f]{6}$/i.test(color)) throw new CommandError("بيانات وسيلة الدفع غير صالحة"); const account = { id: id("account"), code: id("custom"), name, color, icon: "wallet", isActive: true, balance: 0, createdAt: new Date() }; await db.collection("paymentAccounts").insertOne(account, { session }); return account.id; }
  if (type === "account-transfer.post") { const from = await paymentAccount(db, session, body.fromAccountId), to = await paymentAccount(db, session, body.toAccountId), amount = positive(body.amount, "المبلغ"); if (from.id === to.id) throw new CommandError("اختر حسابين مختلفين"); const transferId = id("transfer"), doc = { ...baseDocument("payment-transfer", "BTR"), transferId, paymentMethod: from.id, note: text(body.note), partyId: null, partyName: null }; await financialMovement(db, session, doc, "out", amount, "transfer-out"); doc.paymentMethod = to.id; await financialMovement(db, session, doc, "in", amount, "transfer-in"); await db.collection("accountTransfers").insertOne({ id: transferId, number: doc.number, fromAccountId: from.id, toAccountId: to.id, amount, note: doc.note, occurredAt: doc.occurredAt }, { session }); return transferId; }
  throw new CommandError("العملية غير مدعومة");
}

export async function POST(request: Request) {
  if (!sessionFromRequest(request)) return Response.json({ error: "غير مصرح" }, { status: 401 });
  if (!validSameOrigin(request)) return Response.json({ error: "طلب غير صالح" }, { status: 403 });
  let type = "unknown";
  try {
    const body = await request.json() as Input; type = text(body.type); const db = await getMongo(), client = getMongoClient(); let result = "";
    await client.withSession(session => session.withTransaction(async () => { await db.collection("auditEvents").insertOne({ id: id("audit"), action: type, status: "started", createdAt: new Date() }, { session }); result = await execute(db, session, body); await db.collection("auditEvents").insertOne({ id: id("audit"), action: type, entityId: result, status: "committed", createdAt: new Date() }, { session }); }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }));
    log("info", "api.command.completed", { commandType: type, entityId: result }); return Response.json({ id: result });
  } catch (error) { const status = error instanceof CommandError ? error.status : 500; log("error", "api.command.failed", { commandType: type, error }); return Response.json({ error: error instanceof CommandError ? error.message : "تعذر تنفيذ العملية" }, { status }); }
}
