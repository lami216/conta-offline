import { resolveContaPaths } from "../paths.ts";
import { openSqlite, type SqliteDatabase } from "./sqlite.ts";
let database:SqliteDatabase|undefined;
export function getStorage(){return database??=openSqlite(resolveContaPaths().database)}
export function closeStorage(){database?.close();database=undefined}
export function withTransaction<T>(work:(db:SqliteDatabase)=>T):T{return getStorage().transaction(work)(getStorage())}
