import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";

export type SqliteDatabase = Database.Database;
export function openSqlite(path:string) {
  mkdirSync(dirname(path),{recursive:true});
  const db=new Database(path);
  db.pragma("foreign_keys = ON"); db.pragma("journal_mode = WAL"); db.pragma("busy_timeout = 5000"); db.pragma("synchronous = FULL");
  const migrate=db.transaction(()=>{db.exec(SCHEMA_SQL);const current=(db.prepare("SELECT max(version) version FROM schema_migrations").get() as {version:number|null}).version??0;if(current<SCHEMA_VERSION)db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)").run(SCHEMA_VERSION,"initial relational offline schema",new Date().toISOString());});migrate();
  seedDefaults(db); return db;
}
export function seedDefaults(db:SqliteDatabase){const now=new Date().toISOString();db.transaction(()=>{db.prepare("INSERT OR IGNORE INTO warehouses(id,name,is_sales_default,created_at) VALUES('main','المخزن الرئيسي',1,?)").run(now);for(const a of [{id:"cash",name:"نقدي",color:"#16a34a",icon:"banknote"},{id:"bankily",name:"بنكيلي",color:"#2563eb",icon:"wallet"},{id:"masrvi",name:"مصرفي",color:"#7c3aed",icon:"landmark"},{id:"sedad",name:"السداد",color:"#ea580c",icon:"credit-card"},{id:"bimbank",name:"بيم",color:"#0891b2",icon:"wallet"}])db.prepare("INSERT OR IGNORE INTO payment_accounts(id,code,name,color,icon,created_at) VALUES(?,?,?,?,?,?)").run(a.id,a.id,a.name,a.color,a.icon,now);db.prepare("INSERT OR IGNORE INTO counters(key,value,updated_at) VALUES('productSequence',0,?)").run(now);})();}
