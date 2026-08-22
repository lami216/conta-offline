import initSqlJs, { type Database } from "sql.js";
import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
import type { CanonicalEntity, CanonicalImportPackage, ImportSourceAdapter } from "../migration/types.ts";
import type { AccountBalancePolicy } from "../migration/types.ts";
import { normalizeImportText } from "../migration/matching.ts";

export const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "ascii");
export const MAX_LEGACY_BYTES = 50 * 1024 * 1024;
export const LEGACY_SUPPORTED_TABLES = ["itemsTB","storesTB","stores_itemsTB","customerTB","supplierTB","suppliersTB","BankTB","PayMethods","buyBillTB","items_BuyTB","purchBillTB","items_purchTB","safeTB","process_TypeTB","process_MainType","companyTB"];
const financialReview = ["tblBankDeposit","tblBankConvert","tblBankConvertToSafe","customerAccountTB","customerSolfaTB","suppliersAccountTB","suppliersSolfaTB"];
const unsupported = ["userTB","authTB","EmpTBs","Emp_salaryTB","Emp_mrtbatTB","presenceTB","MaintainceTB","tblPrinter","tblPrinterAccounts","Units","items_UnitsTB","NotesTB","ShowBillTB","items_ShowBillTB"];
export function detectLegacyDatabase(bytes: Uint8Array) { return bytes.length >= 16 && Buffer.from(bytes.subarray(0, 16)).equals(SQLITE_MAGIC); }

/** Resolve the actual runtime asset through Node's package resolver (including standalone deployments). */
export function resolveSqlJsWasmPath() {
  const runtimeRequire = createRequire(join(process.cwd(), "package.json"));
  const wasmPath = runtimeRequire.resolve("sql.js/dist/sql-wasm.wasm");
  if (!isAbsolute(wasmPath)) throw new Error("sql.js WASM path must be absolute");
  return wasmPath;
}

async function open(bytes: Uint8Array) { if (bytes.byteLength > MAX_LEGACY_BYTES) throw new Error("ملف SQLite أكبر من الحد المسموح"); if (!detectLegacyDatabase(bytes)) throw new Error("الملف ليس قاعدة SQLite 3"); const SQL = await initSqlJs({ locateFile: () => resolveSqlJsWasmPath() }); return new SQL.Database(bytes); }
type Row = Record<string, unknown>;
const tables = (db: Database):string[] => db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0]?.values.flat().map(String) ?? [];
const quote = (name: string) => `"${name.replaceAll('"','""')}"`;
function rows(db: Database, table: string): Row[] { const result = db.exec(`SELECT * FROM ${quote(table)}`)[0]; return result ? result.values.map(values => Object.fromEntries(result.columns.map((c,i)=>[c, values[i]]))) : []; }
const get = (r: Row, ...names: string[]) => { const map = new Map(Object.entries(r).map(([k,v])=>[k.toLowerCase(),v])); for (const n of names) if (map.has(n.toLowerCase())) return map.get(n.toLowerCase()); return null; };
const text = (v: unknown) => v == null ? "" : String(v).trim(); const num = (v: unknown) => { const n=Number(v); return Number.isFinite(n)?n:0; };
const date = (v: unknown) => { const raw=text(v), deterministic=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)?`${raw.replace(" ","T")}Z`:raw; const d=new Date(deterministic); return Number.isNaN(d.valueOf()) ? new Date(0).toISOString() : d.toISOString(); };
const normalize = (v: unknown) => text(v).toLocaleLowerCase("ar").replace(/\s+/g," ");
const key = (table:string,id:unknown) => `dataacc:${table}:${text(id)}`;
const id = (prefix:string, legacyKey:string) => `${prefix}-legacy-${Buffer.from(legacyKey).toString("base64url")}`;
const count = (db:Database, available:Set<string>, name:string) => available.has(name)?rows(db,name).length:0;
export type LegacyPreview = { format:"dataacc-sqlite"; groups:Array<{key:string;label:string;count:number;status:"ready"|"unsupported"|"review"}>; warnings:string[]; tables:string[] };
export async function inspectLegacyDatabase(bytes: Uint8Array): Promise<LegacyPreview> { const db=await open(bytes); try { const names=tables(db), a=new Set(names); const groups=[
 ["products","المنتجات",count(db,a,"itemsTB"),"ready"],["warehouses","المخازن",count(db,a,"storesTB"),"ready"],["stocks","أرصدة المخازن",count(db,a,"stores_itemsTB"),"ready"],["sales","فواتير البيع",count(db,a,"buyBillTB"),"ready"],["saleLines","عناصر فواتير البيع",count(db,a,"items_BuyTB"),"ready"],["purchases","فواتير الشراء",count(db,a,"purchBillTB"),"ready"],["purchaseLines","عناصر الشراء",count(db,a,"items_purchTB"),"ready"],["parties","العملاء والموردون",count(db,a,"customerTB")+count(db,a,a.has("suppliersTB")?"suppliersTB":"supplierTB"),"ready"],["accounts","الحسابات والبنوك",count(db,a,"BankTB"),"ready"],["expenses","المصاريف",count(db,a,"safeTB"),"ready"],
 ...unsupported.filter(x=>a.has(x)).map(x=>[x,x.includes("user")||x==="authTB"?"مستخدمون وصلاحيات النظام السابق":x.includes("Emp")||x==="presenceTB"?"بيانات الموظفين القديمة":x.includes("Printer")?"إعدادات الطباعة القديمة":"بيانات تشغيلية غير مطلوبة",count(db,a,x),"unsupported"]), ...financialReview.filter(x=>a.has(x)).map(x=>[x,x.includes("Bank")?"حركة بنكية قديمة":"حركة حساب طرف قديمة",count(db,a,x),"review"])
 ].map(([key,label,count,status])=>({key:String(key),label:String(label),count:Number(count),status:status as "ready"|"unsupported"|"review"})); return {format:"dataacc-sqlite",groups,warnings:financialReview.filter(x=>a.has(x)).map(x=>`${x}: بيانات مالية تحتاج مراجعة — لن يتم استيرادها تلقائيًا`),tables:names}; } finally { db.close(); } }

/** DataAcc is source-specific only here: everything after this boundary consumes canonical entities. */
export async function buildDataAccImportPackage(bytes:Uint8Array,filename?:string):Promise<CanonicalImportPackage>{
 const db=await open(bytes);try{const available=new Set(tables(db)),read=(table:string)=>available.has(table)?rows(db,table):[],entity=(table:string,r:Row,fields:Partial<CanonicalEntity>):CanonicalEntity=>{const sourceId=text(get(r,"id"));return{sourceKey:key(table,sourceId),sourceTable:table,sourceId,...fields}};
 const products=read("itemsTB").map(r=>entity("itemsTB",r,{name:text(get(r,"title")),normalizedName:normalizeImportText(get(r,"title")),barcode:text(get(r,"barcode","code")),data:r}));
 const warehouses=read("storesTB").map(r=>entity("storesTB",r,{name:text(get(r,"title","name","StoreName")),normalizedName:normalizeImportText(get(r,"title","name","StoreName")),data:r}));
 const parties:Array<CanonicalEntity>=[];for(const [table,role] of [["customerTB","customer"],[available.has("suppliersTB")?"suppliersTB":"supplierTB","supplier"]] as const)for(const r of read(table))parties.push(entity(table,r,{name:text(get(r,"title","name","CustomerName","SupplierName")),normalizedName:normalizeImportText(get(r,"title","name","CustomerName","SupplierName")),phone:text(get(r,"phone","tel","mobile")),role,data:r}));
 const paymentAccounts=read("BankTB").map(r=>entity("BankTB",r,{name:text(get(r,"BankName","title","name")),normalizedName:normalizeImportText(get(r,"BankName","title","name")),balance:num(get(r,"rasid")),data:r}));
 const simple=(table:string)=>read(table).map(r=>entity(table,r,{data:r}));const stockBalances=read("stores_itemsTB").map(r=>entity("stores_itemsTB",r,{quantity:num(get(r,"qty")),productSourceKey:key("itemsTB",get(r,"item_idFK")),warehouseSourceKey:key("storesTB",get(r,"store_idFK")),data:r}));
 const entities={products,warehouses,stockBalances,parties,paymentAccounts,financialMovements:[],sales:simple("buyBillTB"),purchases:simple("purchBillTB"),expenses:simple("safeTB")};
 const unknownGroups=financialReview.filter(table=>available.has(table)).map(table=>{const values=read(table);return{key:table,label:table.includes("Bank")?"حركة بنكية قديمة":"حركة حساب طرف قديمة",count:values.length,reason:"نوع أو اتجاه الحركة المالية غير مضمون، لذلك لم تُرحّل تلقائيًا.",columns:Object.keys(values[0]??{}),manualMappingSupported:true}});
 return{source:{type:"dataacc-sqlite",filename,fingerprint:createHash("sha256").update(bytes).digest("hex")},entities,unknownGroups,warnings:unknownGroups.map(x=>`${x.label}: ${x.reason}`)};
 }finally{db.close()}}
export const dataAccAdapter:ImportSourceAdapter={type:"dataacc-sqlite",detect:detectLegacyDatabase,inspect:buildDataAccImportPackage};


