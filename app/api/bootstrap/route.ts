import { getBootstrap } from "../../../lib/services/bootstrap.ts";
export async function GET(){try{return Response.json(getBootstrap(),{headers:{"cache-control":"no-store"}})}catch{return Response.json({error:"تعذر تحميل البيانات المحلية"},{status:500})}}
