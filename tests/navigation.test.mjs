import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
test("desktop navigation has eight unique destinations with reports before settings",async()=>{const source=await readFile(new URL("../app/conta-app.tsx",import.meta.url),"utf8"),match=source.match(/MAIN_NAV_ORDER = \[([^\]]+)\]/);assert.ok(match);const entries=[...match[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);assert.deepEqual(entries,["pos","invoices","warehouses","products","parties","banks","reports","settings"]);assert.equal(new Set(entries).size,entries.length);});
