import { createNativeBackup } from "../../../../../lib/backup.ts";export async function GET(){return Response.json({counts:createNativeBackup().counts})}
