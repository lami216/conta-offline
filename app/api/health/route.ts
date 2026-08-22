import { getStorage } from "../../../lib/storage/index.ts";
export async function GET(){try{getStorage().prepare("SELECT 1").get();return Response.json({status:"ok",database:"sqlite"})}catch{return Response.json({status:"error",database:"unavailable"},{status:503})}}
