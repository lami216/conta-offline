import { createNativeBackup,stringifyBackup } from "../../../../lib/backup.ts";
export async function GET(){const backup=createNativeBackup();return new Response(stringifyBackup(backup),{headers:{"content-type":"application/json","content-disposition":`attachment; filename="conta-offline-${backup.createdAt.slice(0,10)}.json"`}})}
