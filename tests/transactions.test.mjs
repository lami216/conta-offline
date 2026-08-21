import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { execute } from "../app/api/command/route.ts";

let replica, client, db, unavailable;
before(async () => {
  try {
    replica = await MongoMemoryReplSet.create({ binary: { version: "7.0.14" }, replSet: { count: 1, storageEngine: "wiredTiger" } });
    client = new MongoClient(replica.getUri()); await client.connect(); db = client.db("conta_integration_test");
    assert.match(db.databaseName, /test/, "integration tests must never target production");
  } catch (error) { unavailable = `MongoDB test binary unavailable: ${error.message}`; }
});
after(async () => { await client?.close(); await replica?.stop(); });
beforeEach(async () => {
  if (unavailable) return;
  await db.dropDatabase();
  await db.collection("warehouses").insertMany([{ _id: "wh-main", name: "Main", isSalesDefault: true }, { _id: "wh-b", name: "B" }]);
  await db.collection("products").insertOne({ id: "p1", name: "Tea", sku: "TEA", barcode: "", pieceCost: 50, piecePrice: 100, stocks: {} });
  await db.collection("parties").insertOne({ id: "party", name: "Party", phone: "", receivable: 0, payable: 0, net: 0 });
  await db.collection("paymentAccounts").insertOne({ id: "cash-id", code: "cash", name: "Cash", isActive: true, balance: 10000 });
});
async function command(body) {
  let result;
  await client.withSession(s => s.withTransaction(async () => { result = await execute(db, s, body); }));
  return result;
}

test("first purchase initializes missing stock, movement, and supplier payable atomically", async t => {
  if (unavailable) return t.skip(unavailable);
  await command({ type: "purchase.post", warehouseId: "wh-main", partyId: "party", paymentMethod: "note", paidAmount: 500, lines: [{ productId: "p1", quantity: 50, unitPrice: 50 }] });
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 50);
  assert.deepEqual(await db.collection("stockMovements").findOne({}, { projection: { _id: 0, balanceBefore: 1, balanceAfter: 1, quantityDelta: 1 } }), { quantityDelta: 50, balanceBefore: 0, balanceAfter: 50 });
  const doc = await db.collection("documents").findOne({ kind: "purchase" });
  assert.deepEqual([doc.total, doc.paidTotal, doc.dueTotal], [2500, 0, 2500]);
  assert.deepEqual(await db.collection("parties").findOne({ id: "party" }, { projection: { _id: 0, payable: 1, net: 1 } }), { payable: 2500, net: -2500 });
});

test("sale decreases stock and insufficient sale rolls every write back", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("products").updateOne({ id: "p1" }, { $set: { "stocks.wh-main": 100 } });
  await command({ type: "sale.post", warehouseId: "wh-main", partyId: "party", paymentMethod: "note", paidAmount: 700, lines: [{ productId: "p1", quantity: 27, piecePrice: 100 }] });
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 73);
  const beforeCounts = [await db.collection("documents").countDocuments(), await db.collection("stockMovements").countDocuments()];
  await assert.rejects(command({ type: "sale.post", warehouseId: "wh-main", partyId: "party", paymentMethod: "note", paidAmount: 0, lines: [{ productId: "p1", quantity: 74, piecePrice: 100 }] }), /المخزون غير كاف/);
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 73);
  assert.deepEqual([await db.collection("documents").countDocuments(), await db.collection("stockMovements").countDocuments()], beforeCounts);
  assert.equal((await db.collection("parties").findOne({ id: "party" })).receivable, 2000);
});

test("direct sale command rejects a price below authoritative purchase cost", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("products").updateOne({ id: "p1" }, { $set: { "stocks.wh-main": 5, lastPurchaseCost: 12000 } });
  await assert.rejects(command({ type: "sale.post", warehouseId: "wh-main", paymentMethod: "cash", lines: [{ productId: "p1", quantity: 1, piecePrice: 10000 }] }), /تحت سعر الشراء/);
  assert.equal(await db.collection("documents").countDocuments({ kind: "sale" }), 0);
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 5);
});

test("transfer and adjustment initialize missing destination fields", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("products").updateOne({ id: "p1" }, { $set: { "stocks.wh-main": 30 } });
  await command({ type: "transfer.post", fromWarehouseId: "wh-main", toWarehouseId: "wh-b", lines: [{ productId: "p1", quantity: 10 }] });
  let product = await db.collection("products").findOne({ id: "p1" }); assert.deepEqual(product.stocks, { "wh-main": 20, "wh-b": 10 });
  await db.collection("products").updateOne({ id: "p1" }, { $unset: { "stocks.wh-b": "" } });
  await command({ type: "adjustment.post", warehouseId: "wh-b", reason: "count", lines: [{ productId: "p1", actualQuantity: 17 }] });
  product = await db.collection("products").findOne({ id: "p1" }); assert.equal(product.stocks["wh-b"], 17);
  assert.deepEqual(await db.collection("stockMovements").findOne({ type: "adjustment" }, { projection: { _id: 0, balanceBefore: 1, balanceAfter: 1, quantityDelta: 1 } }), { quantityDelta: 17, balanceBefore: 0, balanceAfter: 17 });
});

test("partial returns accumulate only up to sold quantity", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("products").updateOne({ id: "p1" }, { $set: { "stocks.wh-main": 5 } });
  const saleId = await command({ type: "sale.post", warehouseId: "wh-main", partyId: "party", paymentMethod: "cash", paidAmount: 500, lines: [{ productId: "p1", quantity: 5, piecePrice: 100 }] });
  const postedSale = await db.collection("documents").findOne({ id: saleId });
  assert.deepEqual([postedSale.lines[0].costAtSale, postedSale.lines[0].grossProfit], [null, null], "legacy/unproven current pieceCost is not treated as historical cost");
  await command({ type: "sale.return", saleId, lines: [{ productId: "p1", quantity: 2 }] });
  assert.equal((await db.collection("documents").findOne({ kind: "return" })).lines[0].costAtSale, null);
  await command({ type: "sale.return", saleId, lines: [{ productId: "p1", quantity: 3 }] });
  await assert.rejects(command({ type: "sale.return", saleId, lines: [{ productId: "p1", quantity: 1 }] }), /تتجاوز/);
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 5);
});

test("payments, offset, settlement, expense and invalid input preserve balance invariant", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("parties").updateOne({ id: "party" }, { $set: { receivable: 10000, payable: 7000, net: 3000 } });
  await command({ type: "offset.post", partyId: "party", amount: 7000 });
  await command({ type: "payment.post", partyId: "party", side: "receivable", amount: 1000, paymentMethod: "cash-id" });
  await command({ type: "settlement.post", partyId: "party", side: "receivable", amount: 500 });
  const party = await db.collection("parties").findOne({ id: "party" }); assert.deepEqual([party.receivable, party.payable, party.net], [1500, 0, 1500]);
  await command({ type: "expense.post", title: "Rent", amount: 100, occurredAt: "2026-08-15", paymentMethod: "cash-id" });
  assert.equal(await db.collection("documents").countDocuments({ kind: "expense" }), 1);
  const count = await db.collection("documents").countDocuments();
  await assert.rejects(command({ type: "purchase.post", warehouseId: "unknown", partyId: "party", lines: [{ productId: "p1", quantity: -1, unitPrice: 1 }] }));
  assert.equal(await db.collection("documents").countDocuments(), count);
});

test("product codes are atomic, sequential, unique, and independent from barcodes", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("products").createIndex({ sku: 1 }, { unique: true });
  await db.collection("products").insertOne({ id: "legacy", name: "Legacy", sku: "9", barcode: "14313143", stocks: {} });
  const firstId = await command({ type: "product.create", name: "Product A" });
  const secondId = await command({ type: "product.create", name: "Product B" });
  const [first, second] = await Promise.all([
    db.collection("products").findOne({ id: firstId }),
    db.collection("products").findOne({ id: secondId }),
  ]);
  assert.deepEqual([first.sku, second.sku], ["10", "11"]);
  assert.deepEqual([first.barcode, first.pieceCost, first.piecePrice], ["", null, null]);
  await assert.rejects(db.collection("products").insertOne({ id: "duplicate", name: "Duplicate", sku: "11", stocks: {} }), /duplicate key/i);
});

test("safe product deletion hard-deletes unused rows, archives history, rejects stock, and never reuses SKU", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("counters").insertOne({ _id: "productSequence", value: 20 });
  await command({ type: "product.delete", id: "p1" });
  assert.equal(await db.collection("products").findOne({ id: "p1" }), null);
  const next = await command({ type: "product.create", name: "Next" });
  assert.equal((await db.collection("products").findOne({ id: next })).sku, "21");
  await db.collection("products").insertMany([{ id:"history",name:"Historic",sku:"22",barcode:"",stocks:{} },{ id:"stock",name:"Stocked",sku:"23",barcode:"",stocks:{"wh-main":2} }]);
  await db.collection("documents").insertOne({ id:"old",number:"OLD",kind:"sale",lines:[{productId:"history"}] });
  await command({ type:"product.delete", id:"history" });
  assert.equal((await db.collection("products").findOne({id:"history"})).isArchived,true);
  await assert.rejects(command({ type:"product.delete",id:"stock" }),/صفّر المخزون/);
  await assert.rejects(command({type:"purchase.post",warehouseId:"wh-main",partyId:"party",paymentMethod:"note",lines:[{productId:"history",quantity:1,unitPrice:1}]}),/غير موجود/);
  assert.ok(await db.collection("documents").findOne({"lines.productId":"history"}),"historical documents remain queryable");
});


test("product opening stock is validated, auditable, and barcode is unique", async t => {
  if (unavailable) return t.skip(unavailable);
  const plainId = await command({ type: "product.create", name: "Name only" });
  assert.ok(await db.collection("products").findOne({ id: plainId }));
  await assert.rejects(command({ type: "product.create", name: "Missing cost", openingStock: 10 }), /سعر الشراء/);
  const openedId = await command({ type: "product.create", name: "Opened", barcode: "123", openingStock: 10, pieceCost: 100 });
  const opened = await db.collection("products").findOne({ id: openedId });
  assert.equal(opened.stocks["wh-main"], 10); assert.equal(opened.lastPurchaseCost, 100);
  assert.deepEqual(await db.collection("stockMovements").findOne({ productId: openedId }, { projection: { _id: 0, type: 1, balanceBefore: 1, balanceAfter: 1, quantityDelta: 1 } }), { type: "opening", quantityDelta: 10, balanceBefore: 0, balanceAfter: 10 });
  assert.equal((await db.collection("documents").findOne({ "lines.productId": openedId })).title, "رصيد بداية");
  await assert.rejects(command({ type: "product.create", name: "Duplicate", barcode: "123" }), /هذا الباركود مستخدم/);
  const otherId = await command({ type: "product.create", name: "Other", barcode: "456" });
  await assert.rejects(command({ type: "product.update", id: otherId, name: "Other", barcode: "123" }), /هذا الباركود مستخدم/);
});

test("purchases alone may overdraw a payment account", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("paymentAccounts").updateOne({ id: "cash-id" }, { $set: { balance: 100 } });
  await db.collection("paymentAccounts").insertOne({ id: "bank", code: "bank", name: "Bank", isActive: true, balance: 100 });
  await command({ type: "purchase.post", warehouseId: "wh-main", partyId: "party", paymentMethod: "cash-id", lines: [{ productId: "p1", quantity: 10, unitPrice: 100 }] });
  assert.equal((await db.collection("paymentAccounts").findOne({ id: "cash-id" })).balance, -900);
  await assert.rejects(command({ type: "account-transfer.post", fromAccountId: "bank", toAccountId: "cash-id", amount: 1000 }), /الرصيد غير كاف/);
  await assert.rejects(command({ type: "expense.post", title: "Large", amount: 1000, occurredAt: "2026-08-15", paymentMethod: "bank" }), /الرصيد غير كاف/);
});

test("offset has no cash movement, payment has one, and settlement remains compatible", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("parties").updateOne({ id: "party" }, { $set: { receivable: 5000, payable: 3000, net: 2000 } });
  await command({ type: "offset.post", partyId: "party", amount: 1000 });
  assert.equal(await db.collection("financialMovements").countDocuments(), 0);
  await command({ type: "payment.post", partyId: "party", side: "receivable", amount: 500, paymentMethod: "cash-id" });
  assert.equal(await db.collection("financialMovements").countDocuments(), 1);
  await command({ type: "settlement.post", partyId: "party", side: "payable", amount: 500 });
  assert.ok(await db.collection("documents").findOne({ kind: "settlement" }));
});

test("payment accounts create and update without exposing the legacy icon", async t => {
  if (unavailable) return t.skip(unavailable);
  const id = await command({ type: "payment-account.create", name: "Bank", color: "#1677c8" });
  let account = await db.collection("paymentAccounts").findOne({ id });
  assert.equal(account.icon, "wallet");
  await db.collection("paymentAccounts").updateOne({ id }, { $set: { icon: "landmark" } });
  await command({ type: "payment-account.update", id, name: "Bank updated", color: "#123456", isActive: false });
  account = await db.collection("paymentAccounts").findOne({ id });
  assert.deepEqual([account.name, account.color, account.icon, account.isActive], ["Bank updated", "#123456", "landmark", false]);
  assert.ok(await db.collection("paymentAccounts").findOne({ code: "cash" }));
});
