import { sessionFromRequest } from "../../../lib/auth";
import { getMongo } from "../../../lib/mongodb";
import { buildReport, parseReportFilters } from "../../../lib/reports";
export async function GET(request: Request) { if (!sessionFromRequest(request)) return Response.json({ error: "غير مصرح" }, { status: 401 }); try { const filters=parseReportFilters(new URL(request.url)); return Response.json(await buildReport(await getMongo(),filters)); } catch(error) { return Response.json({ error: error instanceof Error?error.message:"تعذر إنشاء التقرير" },{status:400}); } }
