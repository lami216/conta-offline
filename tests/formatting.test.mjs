import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatQuantity,
} from "../app/domain.ts";

const nonLatinDigit = /[٠-٩۰-۹]/;

test("shared display formatters always emit Latin digits", () => {
  const values = [
    formatNumber(1211),
    formatQuantity(222),
    formatMoney(17700),
    formatDate(new Date(2026, 7, 18)),
    formatDateTime(new Date(2026, 7, 18, 14, 5)),
  ];

  assert.equal(formatNumber(1211), "1 211");
  assert.equal(formatMoney(17700), "17 700 MRU");
  assert.match(formatDate(new Date(2026, 7, 18)), /18\/08\/2026/);
  assert.equal(values.some((value) => nonLatinDigit.test(value)), false);
});
