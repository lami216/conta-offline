import { buildReport,parseReportFilters } from "../../../lib/reports.ts";
export async function GET(request:Request){try{return Response.json(buildReport(parseReportFilters(new URL(request.url))))}catch(error){return Response.json({error:error instanceof Error?error.message:"تعذر إنشاء التقرير"},{status:400})}}
