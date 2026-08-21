import assert from "node:assert/strict";
import test from "node:test";
import { updateSaleDraftLine, validateSaleDraft } from "../app/sale-draft.ts";

const product = { id: "lion", name: "أسد زيريار", sku: "1", barcode: "", pieceCost: 12000, lastPurchaseCost: 12000, piecePrice: 7500, stocks: { sales: 5 } };
const draft = (quantity = "1", piecePrice = "7500") => ({ productId: product.id, quantity, piecePrice, unitPrice: "", actualQuantity: "" });

test("sale draft accepts empty and every intermediate price without onChange validation", () => {
  let lines = [draft()];
  for (const piecePrice of ["", "3", "30", "300", "3000", "30000"]) {
    lines = updateSaleDraftLine(lines, product.id, { piecePrice });
    assert.equal(lines[0].piecePrice, piecePrice);
  }
  assert.deepEqual(validateSaleDraft(lines, [product], "sales").errors, []);
});

test("submit validation preserves below-cost price and over-stock quantity in the draft", () => {
  const belowCost = [draft("4", "10000")];
  assert.match(validateSaleDraft(belowCost, [product], "sales").errors.join(" "), /أقل من تكلفة الشراء 12000/);
  assert.equal(belowCost[0].piecePrice, "10000");

  const overStock = [draft("10", "30000")];
  assert.match(validateSaleDraft(overStock, [product], "sales").errors.join(" "), /هي 10 والمتوفر 5 فقط/);
  assert.equal(overStock[0].quantity, "10");
  assert.deepEqual(validateSaleDraft([draft("4", "30000")], [product], "sales").errors, []);
});

test("submit validation rejects temporarily empty quantity and price", () => {
  const result = validateSaleDraft([draft("", "")], [product], "sales");
  assert.equal(result.errors.length, 2);
});
