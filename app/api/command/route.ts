import { executeCommand, CommandError } from "../../../lib/services/commands.ts";
import { validSameOrigin } from "../../../lib/auth.ts";
export async function POST(request:Request){
  if(!validSameOrigin(request))return Response.json({error:"طلب غير صالح"},{status:403});
  try{return Response.json({id:executeCommand(await request.json())})}
  catch(error){return Response.json({error:error instanceof CommandError?error.message:"تعذر تنفيذ العملية"},{status:error instanceof CommandError?error.status:500})}
}
