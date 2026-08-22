"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Banknote,
  Boxes,
  ClipboardCheck,
  CalendarDays,
  ChevronDown,
  Landmark,
  Menu,
  PackagePlus,
  PencilLine,
  Plus,
  Printer,
  Receipt,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  ShoppingCart,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import {
  formatDate,
  formatDateTime,
  kindLabels,
  money,
  number,
  quantity,
  saleLineTotal,
  type BootstrapData,
  type DocumentRecord,
  type Party,
  type Product,
  type PaymentAccount,
} from "./domain";
import { reportNumber, type ReportResponse, type ReportType } from "./report-types";
import { updateSaleDraftLine, validateSaleDraft } from "./sale-draft";
import { readApiResponse } from "./api-response";

type View =
  | "pos"
  | "purchases"
  | "expenses"
  | "parties"
  | "warehouses"
  | "transfers"
  | "adjustments"
  | "products"
  | "records"
  | "reports"
  | "banks"
  | "settings";
type RunCommand = (
  body: Record<string, unknown>,
  message: string,
) => Promise<string>;
type AdjustmentPrefill = { productId: string; warehouseId: string };
type DraftLine = {
  productId: string;
  quantity: string;
  piecePrice: string;
  unitPrice: string;
  actualQuantity: string;
};
const empty: BootstrapData = {
  nextProductCode: 1,
  parties: [],
  warehouses: [],
  products: [],
  documents: [],
  movements: [],
  financialMovements: [],
  paymentAccounts: [],
  recurringExpenses: [],
  accountTransfers: [],
};
function useSessionDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try { const saved = sessionStorage.getItem(`conta:${key}`); return saved ? JSON.parse(saved) as T : initial; } catch { return initial; }
  });
  useEffect(() => { sessionStorage.setItem(`conta:${key}`, JSON.stringify(value)); }, [key, value]);
  return [value, setValue] as const;
}
const nav: Array<{ id: View; label: string; icon: typeof ShoppingCart }> = [
  { id: "pos", label: "نقطة البيع", icon: ShoppingCart },
  { id: "products", label: "المنتجات", icon: PackagePlus },
  { id: "parties", label: "العملاء والموردون", icon: Users },
  { id: "banks", label: "البنوك", icon: Landmark },
  { id: "reports", label: "التقارير", icon: Receipt },
  { id: "settings", label: "الإعدادات", icon: SettingsIcon },
];
const invoiceNav: Array<{ id: View; label: string; icon: typeof Receipt }> = [
  { id: "purchases", label: "فواتير الشراء", icon: PackagePlus },
  { id: "expenses", label: "فواتير المصاريف", icon: WalletCards },
  { id: "records", label: "سجل الفواتير", icon: ReceiptText },
];
const warehouseNav: Array<{ id: View; label: string; icon: typeof Boxes }> = [
  { id: "warehouses", label: "تفاصيل المخازن", icon: Boxes },
  { id: "transfers", label: "التحويلات بين المخازن", icon: ArrowLeftRight },
  { id: "adjustments", label: "تصحيح المخزون", icon: ClipboardCheck },
];
const reportOrder: ReportType[] = ["sales", "purchases", "product-sales", "profit", "returns", "stock", "debts", "party-ledger", "financial", "expenses", "overview"];
export const MAIN_NAV_ORDER = ["pos", "invoices", "warehouses", "products", "parties", "banks", "reports", "settings"] as const;
const val = (v: string) => (v === "" ? 0 : Number(v)),
  lineFor = (p: Product): DraftLine => ({
    productId: p.id,
    quantity: "1",
    piecePrice: String(p.piecePrice ?? 0),
    unitPrice: String(p.pieceCost ?? 0),
    actualQuantity: "",
  });

export default function ContaApp() {
  const [data, setData] = useState<BootstrapData>(empty),
    [view, setView] = useState<View>("pos"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [menu, setMenu] = useState(false),
    [invoiceMenu, setInvoiceMenu] = useState(false),
    [warehouseMenu, setWarehouseMenu] = useState(false),
    [reportMenu, setReportMenu] = useState(false),
    [reportType, setReportType] = useState<ReportType>("sales"),
    [doc, setDoc] = useState<DocumentRecord | null>(null),
    [partyDetail, setPartyDetail] = useState<Party | null>(null),
    [adjustmentPrefill, setAdjustmentPrefill] = useState<AdjustmentPrefill | null>(null);
  const warehouseMenuRef = useRef<HTMLDivElement>(null);
  const invoiceMenuRef = useRef<HTMLDivElement>(null);
  const reportMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!warehouseMenuRef.current?.contains(event.target as Node)) setWarehouseMenu(false);
      if (!invoiceMenuRef.current?.contains(event.target as Node)) setInvoiceMenu(false);
      if (!reportMenuRef.current?.contains(event.target as Node)) setReportMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const navigate = (id: View) => {
    if (id !== "adjustments") setAdjustmentPrefill(null);
    setView(id); setDoc(null); setPartyDetail(null); setMenu(false); setWarehouseMenu(false); setInvoiceMenu(false); setReportMenu(false);
  };
  const openStockAdjustment = (prefill: AdjustmentPrefill) => {
    setAdjustmentPrefill(prefill);
    navigate("adjustments");
  };
  async function reload() {
    setLoading(true);
    try {
      const r = await fetch("/api/bootstrap");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setData(j);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function run(body: Record<string, unknown>, message: string) {
    setError("");
    const r = await fetch("/api/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      j = await r.json();
    if (!r.ok) {
      setError(j.error ?? "تعذر تنفيذ العملية");
      throw new Error(j.error);
    }
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
    await reload();
    return j.id as string;
  }
  const openDoc = (id: string) => {
    const found = data.documents.find((x) => x.id === id);
    if (found) setDoc(found);
  };
  const today = formatDate(new Date(), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    <div className={`app-shell section-${view}`} dir="rtl">
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <b>C</b>
          <div>
            <strong>Conta</strong>
            <span>نظام المتجر</span>
          </div>
          <button className="icon mobile" onClick={() => setMenu(false)}>
            <X />
          </button>
        </div>
        <nav aria-label="التنقل الرئيسي">
          {nav.slice(0, 1).map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "nav active" : "nav"}
              onClick={() => navigate(n.id)}
            >
              <n.icon />
              <span>{n.label}</span>
            </button>
          ))}
          <div className="nav-menu" ref={invoiceMenuRef}>
            <button className={invoiceNav.some(n => n.id === view) ? "nav active" : "nav"} aria-expanded={invoiceMenu} onClick={() => setInvoiceMenu(x => !x)}>
              <ReceiptText /><span>الفواتير</span><ChevronDown className="chevron" />
            </button>
            {invoiceMenu && <div className="nav-popover">
              {invoiceNav.map(n => <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => navigate(n.id)}><n.icon /><span>{n.label}</span></button>)}
            </div>}
          </div>
          <div className="nav-menu" ref={warehouseMenuRef}>
            <button className={warehouseNav.some(n => n.id === view) ? "nav active" : "nav"} aria-expanded={warehouseMenu} onClick={() => setWarehouseMenu(x => !x)}>
              <Boxes /><span>المخازن</span><ChevronDown className="chevron" />
            </button>
            {warehouseMenu && <div className="nav-popover">
              {warehouseNav.map(n => <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => navigate(n.id)}><n.icon /><span>{n.label}</span></button>)}
            </div>}
          </div>
          {nav.slice(1).filter(n => n.id !== "reports" && n.id !== "settings").map((n) => (
            <button key={n.id} className={view === n.id ? "nav active" : "nav"} onClick={() => navigate(n.id)}><n.icon /><span>{n.label}</span></button>
          ))}
          <div className="nav-menu report-nav-menu" ref={reportMenuRef}>
            <button className={view === "reports" ? "nav active" : "nav"} aria-expanded={reportMenu} onClick={() => setReportMenu(value => !value)}><Receipt/><span>التقارير</span><ChevronDown className="chevron"/></button>
            {reportMenu && <div className="nav-popover report-nav-popover">{reportOrder.map(id => <button key={id} aria-current={reportType === id ? "page" : undefined} className={reportType === id ? "active" : ""} onClick={() => { setReportType(id); navigate("reports"); }}><span>{reportNames[id]}</span></button>)}</div>}
          </div>
          {nav.filter(n => n.id === "settings").map(n => <button key={n.id} className={view === n.id ? "nav active" : "nav"} onClick={() => navigate(n.id)}><n.icon /><span>{n.label}</span></button>)}
        </nav>
        <div className="side-foot">
          <span className="owner-mark">م</span><strong>المالك</strong>
          <span className="desktop-mode">وضع المالك المحلي</span>
        </div>
      </aside>
      <main>
        <header className="page-bar">
          <button className="icon mobile" onClick={() => setMenu(true)}>
            <Menu />
          </button>
          <h1>{[...nav, ...invoiceNav, ...warehouseNav].find((n) => n.id === view)?.label}</h1>
          <div className="date-chip"><CalendarDays /><span>{today}</span></div>
          <button className="icon refresh" title="تحديث البيانات" aria-label="تحديث البيانات" onClick={() => void reload()}><RefreshCw /></button>
        </header>
        <div className="content">
          {notice && <div className="toast">{notice}</div>}
          {error && <div className="error">{error}</div>}
          {loading ? (
            <div className="loading">جاري تحميل السجلات…</div>
          ) : doc ? (
            <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`سجل المعاملة ${doc.number}`}>
              <div className="modal-card"><DocumentDetail document={doc} data={data} close={() => setDoc(null)} run={run} /></div>
            </div>
          ) : partyDetail ? (
            <PartyPage
              party={
                data.parties.find((p) => p.id === partyDetail.id) ?? partyDetail
              }
              data={data}
              close={() => setPartyDetail(null)}
              openDoc={openDoc}
              run={run}
            />
          ) : (
            <>
              {view === "pos" && (
                <Pos data={data} run={run} openDoc={openDoc} openStockAdjustment={openStockAdjustment} />
              )}{" "}
              {view === "purchases" && (
                <Purchases data={data} run={run} openDoc={openDoc} />
              )}{" "}
              {view === "expenses" && (
                <Expenses data={data} run={run} openDoc={openDoc} />
              )}{" "}
              {view === "parties" && (
                <Parties data={data} run={run} openParty={setPartyDetail} />
              )}{" "}
              {view === "products" && <Products data={data} run={run} />}{" "}
              {view === "warehouses" && (
                <Warehouses data={data} run={run} openDoc={openDoc} />
              )}{" "}
              {view === "transfers" && (
                <Transfer data={data} run={run} openDoc={openDoc} />
              )}{" "}
              {view === "adjustments" && (
                <Adjustment data={data} run={run} openDoc={openDoc} prefill={adjustmentPrefill} clearPrefill={() => setAdjustmentPrefill(null)} />
              )}{" "}
              {view === "records" && <Records data={data} openDoc={openDoc} />}{" "}
              {view === "reports" && (
                <Reports key={reportType} data={data} openDoc={openDoc} type={reportType} />
              )}{" "}
              {view === "banks" && <Banks data={data} run={run} />}{" "}
              {view === "settings" && <SettingsPage data={data} reload={reload} />}{" "}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

type PreviewGroup = {key:string;label:string;count:number;created:number;matched:number;review:number;skipped:number;unsupported:number};
type FilePreview = { format:string;uploadId?:string;source?:{filename?:string;fingerprint?:string};schemaVersion?:number;createdAt?:string;counts?:Record<string,number>;groups?:PreviewGroup[];unknownGroups?:Array<{key:string;label:string;count:number;reason:string;manualMappingSupported:boolean}>;warnings?:string[];criticalConflicts?:number };
type ImportRun = {importRunId:string;sourceType?:string;filename?:string;state:string;phase:string;progress?:{processed:number;total:number;label:string};counts?:Record<string,{processed:number;created:number;existing:number;skipped:number}>;reviewCount?:number;backupIdBeforeImport?:string;startedAt?:string;completedAt?:string;publicError?:string};
function SettingsPage({data,reload}:{data:BootstrapData;reload:()=>Promise<void>}) {
  const [selectedFile,setSelectedFile]=useState<File|null>(null),[nativePreview,setNativePreview]=useState<FilePreview|null>(null),[externalPreview,setExternalPreview]=useState<FilePreview|null>(null),[importRun,setImportRun]=useState<ImportRun|null>(null),[history,setHistory]=useState<ImportRun[]>([]),[stockPolicy,setStockPolicy]=useState("keep-current"),[accountPolicy,setAccountPolicy]=useState("keep-current"),[busy,setBusy]=useState(""),[message,setMessage]=useState(""),[failure,setFailure]=useState("");
  const request=async(url:string,file:File)=>readApiResponse(await fetch(url,{method:"POST",headers:{"content-type":file.type||"application/octet-stream"},body:file}));
  const loadHistory=async()=>{try{const value=await readApiResponse(await fetch("/api/settings/import-runs")) as {runs:ImportRun[]};setHistory(value.runs)}catch{}};
  useEffect(()=>{let active=true;fetch("/api/settings/import-runs").then(readApiResponse).then(value=>{if(active)setHistory((value as {runs:ImportRun[]}).runs)}).catch(()=>undefined);return()=>{active=false}},[]);
  const uploadExternal=async(file:File)=>{const started=await readApiResponse(await fetch("/api/settings/legacy/upload/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({size:file.size})})),uploadId=String(started.uploadId),chunkSize=Number(started.chunkSize);for(let index=0,offset=0;offset<file.size;index++,offset+=chunkSize)await readApiResponse(await fetch(`/api/settings/legacy/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`,{method:"POST",headers:{"content-type":"application/octet-stream"},body:file.slice(offset,offset+chunkSize)}));return readApiResponse(await fetch("/api/settings/legacy/upload/complete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({uploadId,action:"preview",filename:file.name})}));};
  const download=async()=>{const response=await fetch("/api/settings/backup");if(!response.ok)throw new Error("تعذر إنشاء النسخة");const blob=await response.blob(),link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=response.headers.get("content-disposition")?.match(/filename="([^"]+)/)?.[1]??"conta-backup.conta.json";link.click();URL.revokeObjectURL(link.href);};
  const chooseFile=async(file:File|null)=>{setSelectedFile(file);setNativePreview(null);setExternalPreview(null);setImportRun(null);setFailure("");if(!file)return;setBusy("inspect");try{if(file.name.endsWith(".json")){setNativePreview(await request("/api/settings/restore/preview",file) as FilePreview)}else{setExternalPreview(await uploadExternal(file) as FilePreview)}}catch(e){setFailure(e instanceof Error?e.message:"تعذر فحص المصدر")}finally{setBusy("")}};
  const restore=async()=>{if(!selectedFile||!nativePreview||!confirm("هذه استعادة كاملة وستستبدل بيانات Conta الحالية. هل تريد المتابعة؟"))return;setBusy("restore");setFailure("");try{await download();await request("/api/settings/restore",selectedFile);setMessage("تمت الاستعادة الكاملة وإنشاء نسخة أمان للحالة السابقة");await reload()}catch(e){setFailure(e instanceof Error?e.message:"تعذرت الاستعادة")}finally{setBusy("")}};
  const advance=async(run:ImportRun)=>{let current=run;while(current.state!=="completed"){await new Promise(resolve=>setTimeout(resolve,350));current=await readApiResponse(await fetch(`/api/settings/legacy/import-runs/${encodeURIComponent(current.importRunId)}/advance`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"})) as ImportRun;setImportRun(current);if(current.state==="failed")throw new Error(current.publicError||`تعذر الاستيراد. رقم العملية: ${current.importRunId}`)}return current};
  const importExternal=async()=>{if(!externalPreview?.uploadId)return;setBusy("import");setFailure("");try{let run=await readApiResponse(await fetch("/api/settings/legacy/upload/complete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({uploadId:externalPreview.uploadId,action:"import",stockPolicy,accountBalancePolicy:accountPolicy,filename:selectedFile?.name})})) as ImportRun;setImportRun(run);run=await advance(run);setMessage(`تم الدمج بأمان. نسخة الرجوع: ${run.backupIdBeforeImport}`);await Promise.all([reload(),loadHistory()])}catch(e){setFailure(e instanceof Error?e.message:"تعذر الاستيراد")}finally{setBusy("")}};
  const resume=async(run:ImportRun)=>{setBusy("import");setImportRun(run);setFailure("");try{await advance(run);await Promise.all([reload(),loadHistory()])}catch(e){setFailure(e instanceof Error?e.message:"تعذر استئناف العملية")}finally{setBusy("")}};
  const summary=[['المنتجات',data.products.length],['الأطراف',data.parties.length],['المخازن',data.warehouses.length],['الفواتير',data.documents.length],['الحركات المالية',data.financialMovements.length]] as const;
  return <section className="settings-page"><header className="settings-title"><div><small>الإعدادات</small><h1>مركز النسخ والاستيراد</h1></div><div className="compact-counts">{summary.map(([label,value])=><span key={label}>{label} <b>{number(value)}</b></span>)}</div></header>
    <div className="backup-strip panel"><div><h2>النسخ الاحتياطي</h2><p>نسخة Conta كاملة قابلة للاستعادة.</p></div><button className="primary" disabled={!!busy} onClick={()=>{setBusy("backup");download().then(()=>setMessage("تم إنشاء النسخة وتنزيلها")).catch(e=>setFailure(e.message)).finally(()=>setBusy(""))}}>{busy==="backup"?"جاري الإنشاء…":"إنشاء وتنزيل"}</button></div>
    <article className="panel import-center"><div className="import-head"><div><h2>الاستعادة والاستيراد</h2><p>يُكتشف نوع الملف أولًا؛ نسخة Conta تُستعاد بالكامل والمصادر الخارجية تُدمج فقط.</p></div><label className="file-button">اختيار ملف<input type="file" accept=".json,.conta.json,.db,.sqlite,application/json,application/vnd.sqlite3" onChange={e=>void chooseFile(e.target.files?.[0]??null)}/></label></div>
      <ol className="import-steps"><li className={selectedFile?"done":"active"}>1 فحص الملف</li><li className={externalPreview?"done":""}>2 المطابقة</li><li className={externalPreview?.criticalConflicts?"active":""}>3 مراجعة التعارضات</li><li className={externalPreview?"done":""}>4 المعاينة النهائية</li><li className={importRun?"active":""}>5 الاستيراد</li></ol>
      {busy==="inspect"&&<div className="loading-line">جاري فحص الملف دون تعديل البيانات…</div>}
      {nativePreview&&<div className="source-preview"><div><b>نوع الملف: نسخة Conta v{nativePreview.schemaVersion}</b><small>{nativePreview.createdAt&&formatDateTime(nativePreview.createdAt)}</small></div><div className="preview-count-grid">{Object.entries(nativePreview.counts??{}).map(([k,v])=><span key={k}>{k}<b>{number(v)}</b></span>)}</div><button className="danger" disabled={!!busy} onClick={()=>void restore()}>{busy==="restore"?"جاري الاستعادة…":"استعادة كاملة"}</button></div>}
      {externalPreview&&<div className="source-preview"><div className="preview-heading"><div><b>نوع الملف: DataAcc SQLite</b><small>{selectedFile?.name}</small></div><span className="merge-badge">دمج آمن</span></div><div className="match-table"><div className="match-row match-head"><b>المجموعة</b><b>الإجمالي</b><b>جديد</b><b>مطابق</b><b>مراجعة</b></div>{externalPreview.groups?.filter(g=>g.count>0).map(g=><div className="match-row" key={g.key}><strong>{g.label}</strong><span>{number(g.count)}</span><span className="status-ready">{number(g.created)}</span><span>{number(g.matched)}</span><span className={g.review?"status-review":""}>{number(g.review)}</span></div>)}</div>
        {!!externalPreview.unknownGroups?.length&&<div className="review-groups"><strong>بيانات محفوظة للمراجعة ولا تعطل الاستيراد</strong>{externalPreview.unknownGroups.map(g=><div key={g.key}><span>{g.label} — <b>{number(g.count)}</b></span><small>{g.reason} {g.manualMappingSupported&&"يمكن تعيين أعمدتها يدويًا في إصدار لاحق."}</small></div>)}</div>}
        <div className="policy-row"><label>تعارض المخزون<select value={stockPolicy} onChange={e=>setStockPolicy(e.target.value)}><option value="keep-current">الاحتفاظ برصيد Conta</option><option value="use-imported">استخدام الرصيد المستورد</option><option value="manual-resolution">حل يدوي</option></select></label><label>تعارض رصيد الحساب<select value={accountPolicy} onChange={e=>setAccountPolicy(e.target.value)}><option value="keep-current">الاحتفاظ برصيد Conta</option><option value="use-imported">استخدام الرصيد المستورد</option><option value="adjustment">تسجيل Adjustment بالفرق</option></select></label></div>
        <div className="final-actions"><small>سيتم إنشاء نسخة أمان تلقائية قبل أول مرحلة دمج. لن تُجمع الأرصدة أو كميات المخزون.</small><button className="primary" disabled={!!busy||stockPolicy==="manual-resolution"||!!externalPreview.criticalConflicts} onClick={()=>void importExternal()}>{busy==="import"?"جاري الاستيراد…":"تنفيذ الاستيراد"}</button></div></div>}
      {importRun&&<div className="run-progress"><strong>{importRun.state==="completed"?"اكتملت العملية":importRun.state==="failed"?"توقفت العملية ويمكن إعادة المحاولة":`استيراد ${importRun.progress?.label??"البيانات"}`}</strong><span>{number(importRun.progress?.processed??0)} / {number(importRun.progress?.total??0)}</span><small>رقم العملية: {importRun.importRunId}</small></div>}
    </article>
    <article className="panel import-history"><h2>سجل عمليات الاستيراد</h2>{history.length===0?<p>لا توجد عمليات بعد.</p>:history.map(run=><div className="history-row" key={run.importRunId}><div><b>{run.filename||"DataAcc SQLite"}</b><small>{run.startedAt&&formatDateTime(run.startedAt)} · {run.importRunId.slice(0,8)}</small></div><span className={`run-state ${run.state}`}>{run.state==="completed"?"مكتملة":run.state==="failed"?"تحتاج إعادة محاولة":"قيد التنفيذ"}</span><span>{Object.values(run.counts??{}).reduce((n,x)=>n+x.created,0)} جديد · {Object.values(run.counts??{}).reduce((n,x)=>n+x.existing,0)} مطابق</span>{run.state!=="completed"&&<button className="soft" disabled={!!busy} onClick={()=>void resume(run)}>متابعة</button>}</div>)}</article>
    {message&&<div className="success">{message}</div>}{failure&&<div className="error">{failure}</div>}
  </section>;
}

function Num(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: number;
}) {
  return (
    <input
      className="num"
      dir="ltr"
      inputMode="decimal"
      value={props.value}
      min={props.min ?? 0}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value.replace(/[^0-9.]/g, ""))}
    />
  );
}
type SelectOption = { value: string; label: string; search?: string };
function SearchableSelect({ value, onChange, options, placeholder, searchPlaceholder, disabled = false, allowEmpty = false }: {
  value: string; onChange: (value: string) => void; options: SelectOption[];
  placeholder: string; searchPlaceholder: string; disabled?: boolean; allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const normalized = query.trim().toLocaleLowerCase("ar");
  const matches = options.map((option, index) => ({ option, index, text: `${option.label} ${option.search ?? ""}`.toLocaleLowerCase("ar") }))
    .filter(x => !normalized || x.text.includes(normalized))
    .sort((a, b) => {
      const score = (x: typeof a) => x.text === normalized ? 0 : x.text.startsWith(normalized) ? 1 : x.option.label.toLocaleLowerCase("ar").startsWith(normalized) ? 2 : 3;
      return score(a) - score(b) || a.index - b.index;
    }).slice(0, 20).map(x => x.option);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close);
  }, []);
  const choose = (next: string) => { onChange(next); setOpen(false); setQuery(""); setActive(0); };
  return <div className="combobox" ref={root}>
    <button type="button" className="combobox-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(x => !x)}>
      <span>{options.find(x => x.value === value)?.label ?? placeholder}</span><ChevronDown />
    </button>
    {open && <div className="combobox-popover">
      <label className="search"><Search /><input autoFocus value={query} placeholder={searchPlaceholder} onChange={e => { setQuery(e.target.value); setActive(0); }} onKeyDown={e => {
        if (e.key === "Escape") setOpen(false);
        if (e.key === "ArrowDown") { e.preventDefault(); setActive(x => Math.min(x + 1, matches.length - 1)); }
        if (e.key === "ArrowUp") { e.preventDefault(); setActive(x => Math.max(x - 1, 0)); }
        if (e.key === "Enter" && matches[active]) { e.preventDefault(); choose(matches[active].value); }
      }} /></label>
      <div className="combobox-results" role="listbox">
        {allowEmpty && <button type="button" onClick={() => choose("")}>{placeholder}</button>}
        {matches.map((option, index) => <button type="button" role="option" aria-selected={option.value === value} className={index === active || option.value === value ? "active" : ""} key={option.value} onMouseEnter={() => setActive(index)} onClick={() => choose(option.value)}>{option.label}</button>)}
        {!matches.length && <div className="combobox-empty">لا توجد نتائج</div>}
      </div>
    </div>}
  </div>;
}
function ProductSearchPicker({ data, query, setQuery, onPick, mode = "sale", warehouseId }: {
  data: BootstrapData; query: string; setQuery: (value: string) => void; onPick: (product: Product) => void;
  mode?: "sale" | "purchase" | "transfer" | "adjustment" | "inventory"; warehouseId?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const term = query.trim().toLocaleLowerCase("ar");
  const results = useMemo(() => term ? data.products.filter(product => !product.isArchived).map((product, index) => {
    const name = product.name.toLocaleLowerCase("ar"), sku = (product.sku ?? "").toLocaleLowerCase("ar"), barcode = (product.barcode ?? "").toLocaleLowerCase("ar");
    const score = barcode === term || sku === term ? 0 : barcode.startsWith(term) || sku.startsWith(term) ? 1 : name.startsWith(term) ? 2 : name.includes(term) ? 3 : 4;
    return { product, index, score, matches: `${name} ${sku} ${barcode}`.includes(term) };
  }).filter(item => item.matches).sort((a, b) => a.score - b.score || a.index - b.index).slice(0, 30).map(item => item.product) : [], [data.products, term]);
  const add = (product: Product) => {
    const stock = Number(product.stocks?.[warehouseId ?? ""] ?? Object.values(product.stocks).reduce((a, b) => a + b, 0));
    if (mode === "sale" && stock <= 0) return;
    onPick(product); setSelected(null);
  };
  return <div className="product-picker product-search-grid">
    <label className="search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالاسم أو الكود أو الباركود" /></label>
    <div className="erp-table-wrap picker-results"><table className="erp-table" aria-label="نتائج بحث المنتجات"><colgroup><col style={{width:"16%"}}/><col style={{width:"36%"}}/><col style={{width:"18%"}}/><col style={{width:"16%"}}/><col style={{width:"14%"}}/></colgroup><thead><tr><th>الرمز</th><th>المنتج</th><th>{mode === "purchase" ? "آخر شراء" : "السعر"}</th><th>المتوفر</th><th>إضافة</th></tr></thead><tbody>
      {results.map(product => { const stock = Number(product.stocks?.[warehouseId ?? ""] ?? Object.values(product.stocks).reduce((a, b) => a + b, 0)), disabled = mode === "sale" && stock <= 0; return <tr key={product.id} className={selected === product.id ? "selected" : ""} onClick={() => setSelected(product.id)} onDoubleClick={() => add(product)}><td dir="ltr">{product.sku || "—"}</td><td className="name-cell">{product.name}</td><td className="num-cell">{number(mode === "purchase" ? product.lastPurchaseCost ?? product.pieceCost ?? 0 : product.piecePrice ?? 0)}</td><td className="num-cell">{number(stock)}</td><td className="action-cell"><button type="button" className="soft" disabled={disabled} onClick={event => { event.stopPropagation(); add(product); }}>إضافة</button></td></tr>; })}
      {term && !results.length && <tr><td colSpan={5}>لا توجد نتائج</td></tr>}
    </tbody></table></div>
  </div>;
}
const SearchProducts = ProductSearchPicker;

function BarcodeScanner({ products, onScan }: { products: Product[]; onScan: (product: Product) => void }) {
  const [enabled, setEnabled] = useState(false), [buffer, setBuffer] = useState(""), [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (enabled) input.current?.focus(); }, [enabled]);
  function submit() {
    const barcode = buffer.trim(), product = products.find(item => !item.isArchived && item.barcode === barcode);
    if (product) { onScan(product); setNotice(""); } else if (barcode) setNotice("لا يوجد منتج بهذا الباركود");
    setBuffer(""); requestAnimationFrame(() => input.current?.focus());
  }
  return <div className="barcode-scanner"><button type="button" className={enabled ? "soft selected" : "soft"} onClick={() => setEnabled(value => !value)}>{enabled ? "● المسح مفعل" : "مسح باركود"}</button>{enabled && <input ref={input} dir="ltr" autoComplete="off" value={buffer} onChange={event => setBuffer(event.target.value)} onKeyDown={event => { if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); submit(); } }} placeholder="امسح الباركود ثم Enter" />}{notice && <span>{notice}</span>}</div>;
}

function LineEditor({
  line,
  product,
  onChange,
  onRemove,
  mode,
  availableStock,
}: {
  line: DraftLine;
  product: Product;
  onChange: (x: DraftLine) => void;
  onRemove: () => void;
  mode: "sale" | "purchase" | "transfer" | "adjust";
  availableStock?: number;
}) {
  const qty = val(line.quantity);
  return (
    <div className="line">
      <div className="line-title">
        <span>
          <strong>{product.name}</strong>
          <small>
            {mode === "purchase" && qty
              ? `يعادل ${quantity(qty)}`
              : `المتاح: ${number(mode === "sale" || mode === "adjust" ? (availableStock ?? 0) : Object.values(product.stocks).reduce((a, b) => a + b, 0))} فرد`}
          </small>
        </span>
        <button className="icon danger" onClick={onRemove}>
          <X />
        </button>
      </div>
      <div className="line-fields">
        {mode === "adjust" ? (
          <label>
            الكمية الفعلية
            <Num
              value={line.actualQuantity}
              onChange={(v) => onChange({ ...line, actualQuantity: v })}
            />
          </label>
        ) : (
          <label>
            الكمية بالأفراد
            <Num
              value={line.quantity}
              onChange={(v) => onChange({ ...line, quantity: v })}
            />
          </label>
        )}
        {mode === "sale" && (
          <label>
            سعر الفرد
            <Num
              value={line.piecePrice}
              onChange={(v) => onChange({ ...line, piecePrice: v })}
            />
          </label>
        )}
        {mode === "purchase" && (
          <label>
            سعر الشراء للفرد
            <Num
              value={line.unitPrice}
              onChange={(v) => onChange({ ...line, unitPrice: v })}
            />
          </label>
        )}
        {mode === "adjust" && val(line.actualQuantity) > (availableStock ?? 0) && product.lastPurchaseCost == null && (
          <label>
            تكلفة الشراء للفرد
            <Num value={line.unitPrice} onChange={(v) => onChange({ ...line, unitPrice: v })} />
          </label>
        )}
      </div>
      {mode === "sale" && (
        <b className="line-total">
          إجمالي المنتج: {" "}
          {money(
            saleLineTotal(qty, val(line.piecePrice)),
          )}
        </b>
      )}
    </div>
  );
}

function Pos({
  data,
  run,
  openDoc,
}: {
  data: BootstrapData;
  run: RunCommand;
  openDoc: (id: string) => void;
  openStockAdjustment: (prefill: AdjustmentPrefill) => void;
}) {
  const [query, setQuery] = useState(""),
    [lines, setLines] = useSessionDraft<DraftLine[]>("sale-lines", []),
    [payment, setPayment] = useSessionDraft("sale-payment", "cash"),
    [partyId, setPartyId] = useSessionDraft("sale-party", ""),
    [quick, setQuick] = useState(false),
    [selectedLine, setSelectedLine] = useState<string | null>(null),
    [stockNotice, setStockNotice] = useState("");
  const wh = data.warehouses.find((w) => w.isSalesDefault),
    details = lines.flatMap((l) => {
      const p = data.products.find((x) => x.id === l.productId);
      return p
        ? [
            {
              l,
              p,
              total: saleLineTotal(val(l.quantity), val(l.piecePrice)),
            },
          ]
        : [];
    }),
    total = details.reduce((s, x) => s + x.total, 0);
  function add(p: Product) {
    const available = Number(p.stocks?.[wh?.id ?? ""] ?? 0);
    if (!wh || available <= 0) { setStockNotice("المنتج غير متوفر في مخزن البيع"); return; }
    setLines(current => { const existing = current.find(line => line.productId === p.id); if (!existing) return [lineFor(p), ...current]; if (val(existing.quantity) >= available) { setStockNotice(`الكمية المتوفرة ${number(available)} فقط`); return current; } return current.map(line => line.productId === p.id ? { ...line, quantity: String(val(line.quantity) + 1) } : line); });
  }
  function updateSaleLine(product: Product, patch: Partial<DraftLine>) {
    setLines(current => updateSaleDraftLine(current, product.id, patch));
  }

  async function submit() {
    const validation = validateSaleDraft(lines, data.products, wh?.id);
    if (validation.errors.length) {
      setSelectedLine(validation.invalidProductIds.values().next().value ?? null);
      setStockNotice(`تعذر إتمام البيع:\n• ${validation.errors.join("\n• ")}`);
      return;
    }
    const id = await run(
      {
        type: "sale.post",
        warehouseId: wh?.id,
        paymentMethod: payment,
        paidAmount: payment === "note" ? 0 : total,
        partyId: payment === "note" ? partyId : null,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: val(l.quantity),
          piecePrice: val(l.piecePrice),
        })),
      },
      "تم اعتماد فاتورة البيع",
    );
    setLines([]);
    setSelectedLine(null);
    setPayment("cash");
    setPartyId("");
    openDoc(id);
  }
  const invoice = <div className="panel invoice-card workspace-invoice">
    <div className="invoice-card-head"><h3>الفاتورة</h3><div><span className="product-count">{number(lines.length)} منتج</span>{lines.length > 0 && <button className="clear-draft" onClick={() => { if (confirm("هل تريد مسح الفاتورة؟")) { setLines([]); } }}>مسح الفاتورة</button>}</div></div>
    <div className={lines.length ? "invoice-preview has-items" : "invoice-preview"}>{lines.length ? <div className="erp-table-wrap invoice-preview-list"><table className="erp-table invoice-table" aria-label="منتجات الفاتورة"><colgroup><col style={{width:"38%"}}/><col style={{width:"14%"}}/><col style={{width:"17%"}}/><col style={{width:"19%"}}/><col style={{width:"12%"}}/></colgroup><thead><tr><th>الاسم</th><th>الكمية</th><th>السعر</th><th>المجموع</th><th>حذف</th></tr></thead><tbody>{details.map(({ l, p, total: lineTotal }) => <tr className={selectedLine === p.id ? "selected" : ""} onClick={() => setSelectedLine(p.id)} key={p.id}><td className="name-cell">{p.name}</td><td className="num-cell"><Num value={l.quantity} onChange={value => updateSaleLine(p, { quantity: value })} /></td><td className="num-cell"><Num value={l.piecePrice} onChange={value => updateSaleLine(p, { piecePrice: value })} /></td><td className="num-cell">{number(lineTotal)}</td><td className="action-cell"><button type="button" className="row-delete" aria-label={`حذف ${p.name}`} onClick={event => { event.stopPropagation(); setLines(current => current.filter(item => item.productId !== p.id)); }}><X /></button></td></tr>)}</tbody></table></div> : <div className="empty-invoice-state"><span><ReceiptText /></span><b>الفاتورة فارغة</b></div>}</div>
  </div>;
  const checkout = <aside className="panel workspace-checkout"><div className="checkout-head"><h3>الدفع</h3></div><div className="checkout-body"><div className="invoice-meta-row" aria-label="نوع الفاتورة"><button className={payment !== "note" ? "meta-option selected" : "meta-option"} onClick={() => setPayment("cash")}><Banknote /><span><small>طريقة التحصيل</small><b>دفع مباشر</b></span></button><button className={payment === "note" ? "meta-option selected secondary" : "meta-option secondary"} onClick={() => setPayment("note")}><PencilLine /><span><small>نوع البيع</small><b>ملاحظة</b></span></button></div>{payment !== "note" && <div className="payment-section"><span className="payment-label">طريقة الدفع</span><CompactPaymentSelector accounts={data.paymentAccounts} value={payment} onChange={setPayment} /></div>}{payment === "note" && <><label>اختيار العميل<SearchableSelect value={partyId} onChange={setPartyId} placeholder="اختر العميل" searchPlaceholder="ابحث باسم العميل أو رقم الهاتف" options={data.parties.map(p => ({ value: p.id, label: p.name, search: p.phone }))} /></label><button className="link" onClick={() => setQuick(!quick)}><Plus /> إضافة عميل</button>{quick && <QuickParty run={run} onDone={() => setQuick(false)} />}</>}</div><div className="checkout-footer"><div className="total invoice-total"><span>الإجمالي</span><strong>{money(total)}</strong></div><button className="primary wide" disabled={!lines.length || !wh || (payment === "note" && !partyId)} onClick={() => void submit()}>إتمام البيع</button></div></aside>;
  return <section className="transaction-page">{stockNotice && <div className="toast stock-toast">{stockNotice}</div>}<div className="transaction-workspace pos-workspace"><div className="workspace-discovery"><div className="panel search-panel"><div className="search-title-row"><div className="panel-title">بحث المنتجات</div><BarcodeScanner products={data.products} onScan={add} /></div><SearchProducts data={data} query={query} setQuery={setQuery} onPick={add} mode="sale" warehouseId={wh?.id} /></div><InvoiceQuickBrowser title="سجل الفواتير" docs={data.documents.filter(d => d.kind === "sale")} openDoc={openDoc} /></div>{invoice}{checkout}</div></section>;

}

function CompactPaymentSelector({ accounts, value, onChange }: { accounts: PaymentAccount[]; value: string; onChange: (id: string) => void }) {
  const active = accounts.filter(account => account.isActive), cash = active.find(account => account.code === "cash"), banks = active.filter(account => account.code !== "cash");
  const selectedBank = banks.find(account => account.id === value || account.code === value);
  return <div className="compact-payment" aria-label="طريقة الدفع">
    {cash && <button type="button" className={!selectedBank ? "soft selected" : "soft"} onClick={() => onChange(cash.id)}>نقدي</button>}
    <label><span className="sr-only">الحساب البنكي</span><select value={selectedBank?.id ?? ""} onChange={event => onChange(event.target.value)}><option value="">بنك ▼</option>{banks.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
  </div>;
}

function QuickParty({ run, onDone }: { run: RunCommand; onDone: () => void }) {
  const [name, setName] = useState(""),
    [phone, setPhone] = useState("");
  return (
    <div className="mini-form">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="اسم العميل"
      />
      <input
        dir="ltr"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="رقم الهاتف"
      />
      <button
        className="primary"
        onClick={async () => {
          await run({ type: "party.create", name, phone }, "تمت إضافة العميل");
          onDone();
        }}
      >
        حفظ
      </button>
    </div>
  );
}
function Purchases({ data, run, openDoc }: { data: BootstrapData; run: RunCommand; openDoc: (id: string) => void }) {
  const [partyId, setPartyId] = useSessionDraft("purchase-party", "");
  const [locked, setLocked] = useSessionDraft("purchase-locked", false);
  const [warehouseId, setWarehouseId] = useSessionDraft("purchase-warehouse", "");
  const [lines, setLines] = useSessionDraft<DraftLine[]>("purchase-lines", []);
  const [payment, setPayment] = useSessionDraft("purchase-payment", "cash");
  const [query, setQuery] = useState("");
  const [addingWh, setAddingWh] = useState(false);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const details = lines.flatMap(line => { const product = data.products.find(p => p.id === line.productId); return product ? [{ line, product }] : []; });
  const total = details.reduce((sum, item) => sum + Math.round(val(item.line.quantity) * val(item.line.unitPrice)), 0);
  function updatePurchaseLine(product: Product, patch: Partial<DraftLine>) {
    setLines(current => current.map(line => line.productId === product.id ? { ...line, ...patch } : line));
  }
  function pick(product: Product) {
    setLines(current => current.some(line => line.productId === product.id) ? current.map(line => line.productId === product.id ? { ...line, quantity: String(val(line.quantity) + 1) } : line) : [lineFor(product), ...current]);
  }
  function clearDraft() {
    if (!confirm("هل تريد مسح فاتورة الشراء؟")) return;
    setLines([]); setPartyId(""); setLocked(false); setWarehouseId(""); setPayment("cash");
  }
  async function submit() {
    const id = await run({ type: "purchase.post", partyId, warehouseId, paymentMethod: payment, lines: lines.map(line => ({ productId: line.productId, quantity: val(line.quantity), unitPrice: val(line.unitPrice) })) }, "تم اعتماد فاتورة الشراء");
    setLines([]); setSelectedLine(null); setPartyId(""); setLocked(false); setWarehouseId(""); setPayment("cash"); openDoc(id);
  }
  return <section className="transaction-page"><div className="transaction-workspace purchase-workspace">
    <div className="workspace-discovery"><div className="panel search-panel"><div className="search-title-row"><div className="panel-title">بحث المنتجات</div><BarcodeScanner products={data.products} onScan={pick} /></div><SearchProducts data={data} query={query} setQuery={setQuery} onPick={pick} mode="purchase" warehouseId={warehouseId} /></div><InvoiceQuickBrowser title="سجل فواتير الشراء" docs={data.documents.filter(d => d.kind === "purchase")} openDoc={openDoc} /></div>
    <div className="panel invoice-card workspace-invoice"><div className="invoice-card-head"><h3>فاتورة الشراء الحالية</h3><div><span className="product-count">{number(lines.length)} منتج</span>{lines.length > 0 && <button className="clear-draft" onClick={clearDraft}>مسح الفاتورة</button>}</div></div><div className={lines.length ? "invoice-preview has-items" : "invoice-preview"}>{lines.length ? <div className="erp-table-wrap invoice-preview-list"><table className="erp-table invoice-table"><colgroup><col style={{width:"38%"}}/><col style={{width:"14%"}}/><col style={{width:"17%"}}/><col style={{width:"19%"}}/><col style={{width:"12%"}}/></colgroup><thead><tr><th>الاسم</th><th>الكمية</th><th>سعر الشراء</th><th>المجموع</th><th>حذف</th></tr></thead><tbody>{details.map(({line, product}) => <tr key={product.id} onClick={() => setSelectedLine(product.id)} className={selectedLine === product.id ? "selected" : ""}><td className="name-cell">{product.name}</td><td className="num-cell"><Num value={line.quantity} onChange={value => updatePurchaseLine(product, { quantity: value })} /></td><td className="num-cell"><Num value={line.unitPrice} onChange={value => updatePurchaseLine(product, { unitPrice: value })} /></td><td className="num-cell">{number(val(line.quantity) * val(line.unitPrice))}</td><td className="action-cell"><button type="button" className="row-delete" aria-label={`حذف ${product.name}`} onClick={event => { event.stopPropagation(); setLines(current => current.filter(item => item.productId !== product.id)); }}><X /></button></td></tr>)}</tbody></table></div> : <div className="empty-invoice-state"><span><ReceiptText /></span><b>الفاتورة فارغة</b></div>}</div></div>
    <aside className="panel workspace-checkout"><div className="checkout-head"><h3>اعتماد الشراء</h3></div><div className="checkout-body purchase-details"><label>المورد<SearchableSelect disabled={locked} value={partyId} onChange={setPartyId} placeholder="اختر المورد" searchPlaceholder="ابحث باسم المورد أو رقم الهاتف" options={data.parties.map(p => ({ value: p.id, label: `${p.name} — ${p.phone}`, search: p.phone }))} /></label><button className="soft" disabled={!partyId} onClick={() => locked ? confirm("هل تريد تغيير المورد؟ ستبقى المنتجات كما هي.") && setLocked(false) : setLocked(true)}>{locked ? "تعديل المورد" : "تأكيد المورد"}</button><label>مخزن الاستلام<SearchableSelect value={warehouseId} onChange={setWarehouseId} placeholder="اختر المخزن" searchPlaceholder="ابحث عن مخزن" options={data.warehouses.map(w => ({ value: w.id, label: w.name }))} /></label><button className="link" onClick={() => setAddingWh(!addingWh)}><Plus /> إضافة مخزن</button>{addingWh && <InlineCreate label="اسم المخزن" onSave={async name => { await run({ type: "warehouse.create", name }, "تمت إضافة المخزن"); setAddingWh(false); }} />}<div className="invoice-meta-row"><button className={payment !== "note" ? "meta-option selected" : "meta-option"} onClick={() => setPayment("cash")}><Banknote /><span><small>نوع التسوية</small><b>دفع مباشر</b></span></button><button className={payment === "note" ? "meta-option selected secondary" : "meta-option secondary"} onClick={() => setPayment("note")}><PencilLine /><span><small>نوع التسوية</small><b>ملاحظة</b></span></button></div>{payment !== "note" && <div className="payment-section"><span className="payment-label">الدفع من حساب</span><CompactPaymentSelector accounts={data.paymentAccounts} value={payment} onChange={setPayment} /></div>}{payment === "note" && <p className="note-hint">ستسجل الفاتورة كاملة دينًا علينا للمورد، دون حركة نقدية.</p>}</div><div className="checkout-footer"><div className="total invoice-total"><span>الإجمالي</span><strong>{money(total)}</strong></div><button className="primary wide" disabled={!locked || !warehouseId || !lines.length} onClick={() => void submit()}>اعتماد فاتورة الشراء</button></div></aside>
  </div></section>;

}
function Expenses({ data, run, openDoc }: { data: BootstrapData; run: RunCommand; openDoc: (id: string) => void }) {
  const [title, setTitle] = useSessionDraft("expense-title", ""),
    [amount, setAmount] = useSessionDraft("expense-amount", ""),
    [date, setDate] = useSessionDraft("expense-date", new Date().toISOString().slice(0, 10)),
    [frequency, setFrequency] = useSessionDraft("expense-frequency", "once"),
    [paymentMethod, setPaymentMethod] = useSessionDraft("expense-payment", "");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [paying, setPaying] = useState<string | null>(null);
  const accounts = data.paymentAccounts.filter(account => account.isActive);
  const accountName = (id: string | null) => data.paymentAccounts.find(a => a.id === id || a.code === id)?.name ?? "—";
  const expenseDocs = data.documents.filter(d => d.kind === "expense"
    && (!historyQuery.trim() || `${d.title ?? ""} ${d.number}`.toLocaleLowerCase("ar").includes(historyQuery.trim().toLocaleLowerCase("ar")))
    && (!historyFrom || d.occurredAt.slice(0, 10) >= historyFrom)
    && (!historyTo || d.occurredAt.slice(0, 10) <= historyTo));
  return <section className="expense-workspace workspace-page">
    <div className="expense-grid">
      <form className="panel expense-form" onSubmit={async event => { event.preventDefault(); const id = await run({ type: "expense.post", title, amount: val(amount), occurredAt: date, frequency, paymentMethod }, frequency === "once" ? "تم تسجيل المصروف" : "تم حفظ التذكير دون خصم"); setTitle(""); setAmount(""); if (frequency === "once") openDoc(id); }}>
        <div className="section-title"><h3>مصروف جديد</h3></div>
        <div className="expense-fields">
          <label>عنوان المصروف<input required value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label>المبلغ<Num value={amount} onChange={setAmount} /></label>
          <label>تاريخ المصروف<input dir="ltr" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>التكرار<select value={frequency} onChange={e => setFrequency(e.target.value)}><option value="once">مرة واحدة</option><option value="daily">يومي</option><option value="monthly">شهري</option></select></label>
          {frequency === "once" && <label>وسيلة الدفع<select required value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option value="">اختر وسيلة الدفع</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} — {money(a.balance)}</option>)}</select></label>}
        </div><button className="primary expense-save" disabled={!title || !amount || (frequency === "once" && !paymentMethod)}>{frequency === "once" ? "حفظ الفاتورة" : "حفظ التذكير"}</button>
      </form>
      <div className="panel expense-recurring"><div className="section-title"><h3>المصاريف المستحقة</h3><b>{number(data.recurringExpenses.length)}</b></div><div className="erp-table-wrap expense-scroll"><table className="erp-table" aria-label="المصاريف المستحقة"><colgroup><col style={{width:"27%"}}/><col style={{width:"19%"}}/><col style={{width:"17%"}}/><col style={{width:"22%"}}/><col style={{width:"15%"}}/></colgroup><thead><tr><th>المصروف</th><th>الاستحقاق</th><th>المبلغ</th><th>الحالة / الحساب</th><th>إجراء</th></tr></thead><tbody>
        {data.recurringExpenses.map(r => <tr key={r.id}><td className="name-cell">{r.title}</td><td>{formatDate(r.currentDueDate)}</td><td className="num-cell">{money(r.amount)}</td><td>{r.currentPaymentMethodId ? `مدفوع · ${accountName(r.currentPaymentMethodId)}` : r.frequency === "daily" ? "يومي · غير مدفوع" : "شهري · غير مدفوع"}</td><td className="action-cell">{r.currentPaymentMethodId ? accountName(r.currentPaymentMethodId) : <button className="soft" onClick={() => setPaying(r.id)}>تسجيل الدفع</button>}</td></tr>)}
        {!data.recurringExpenses.length && <tr><td colSpan={5}>لا توجد مصاريف متكررة</td></tr>}
      </tbody></table></div></div>
      <div className="panel expense-history"><div className="section-title"><h3>سجل المصاريف</h3></div><div className="expense-history-filters"><label className="search"><Search /><input value={historyQuery} onChange={e => setHistoryQuery(e.target.value)} placeholder="بحث بالعنوان أو رقم المستند" /></label><label>من<input dir="ltr" type="date" value={historyFrom} onChange={e => setHistoryFrom(e.target.value)} /></label><label>إلى<input dir="ltr" type="date" value={historyTo} onChange={e => setHistoryTo(e.target.value)} /></label></div><div className="erp-table-wrap expense-scroll"><table className="erp-table" aria-label="سجل المصاريف"><colgroup><col style={{width:"16%"}}/><col style={{width:"24%"}}/><col style={{width:"15%"}}/><col style={{width:"18%"}}/><col style={{width:"13%"}}/><col style={{width:"14%"}}/></colgroup><thead><tr><th>التاريخ</th><th>العنوان</th><th>المبلغ</th><th>وسيلة الدفع</th><th>النوع</th><th>المستند</th></tr></thead><tbody>{expenseDocs.map(document => <tr key={document.id} onClick={() => openDoc(document.id)}><td>{formatDate(document.occurredAt)}</td><td className="name-cell">{document.title ?? "مصروف"}</td><td className="num-cell">{money(document.total)}</td><td>{accountName(document.paymentMethod)}</td><td>{document.recurringId ? "متكرر" : "مرة واحدة"}</td><td dir="ltr">{document.number}</td></tr>)}{!expenseDocs.length && <tr><td colSpan={6}>لا توجد فواتير مطابقة</td></tr>}</tbody></table></div></div>
    </div>
    {paying && <div className="modal-overlay" role="dialog" aria-modal="true"><form className="modal-card payment-dialog" onSubmit={async e => { e.preventDefault(); if (!paymentMethod) return; const recurring = data.recurringExpenses.find(r => r.id === paying)!; await run({ type: "expense.materialize", recurringId: paying, dueDate: recurring.currentDueDate, paymentMethod }, "تم تسجيل دفع الاستحقاق"); setPaying(null); }}><div className="section-title"><h3>تسجيل الدفع</h3><button type="button" className="icon" onClick={() => setPaying(null)}><X /></button></div><label>تم الدفع من<select required value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option value="">اختر الحساب</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} — {money(a.balance)}</option>)}</select></label><button className="primary">تأكيد الدفع</button></form></div>}
  </section>;
}
function Banks({ data, run }: { data: BootstrapData; run: RunCommand }) {
  const [tab, setTab] = useState<"accounts" | "movements" | "transfers">("accounts");
  const [editing, setEditing] = useState<PaymentAccount | null>(null);
  const [from, setFrom] = useState(""), [to, setTo] = useState(""), [amount, setAmount] = useState(""), [note, setNote] = useState("");
  const [accountFilter, setAccountFilter] = useState(""), [typeFilter, setTypeFilter] = useState("");
  const active = data.paymentAccounts.filter(a => a.isActive);
  const name = (id: string) => data.paymentAccounts.find(a => a.id === id || a.code === id)?.name ?? id;
  const movements = data.financialMovements.filter(m => (!accountFilter || m.paymentMethod === accountFilter) && (!typeFilter || m.type === typeFilter));
  const total = data.paymentAccounts.reduce((sum, account) => sum + account.balance, 0);
  const purchaseTotal = data.paymentAccounts.reduce((sum, account) => sum + account.purchaseTotal, 0);
  const today = new Date().toISOString().slice(0, 10);
  const todayMovements = data.financialMovements.filter(m => m.occurredAt.slice(0, 10) === today);
  const movementLabels: Record<string, string> = { sale: "بيع", purchase: "شراء", expense: "مصروف", "party-receipt": "سداد عميل", "party-payment": "سداد مورد", "transfer-in": "تحويل داخل", "transfer-out": "تحويل خارج" };
  return <section className="banks-workspace workspace-page">
    <div className="bank-summary"><div><small>إجمالي الأرصدة الحالية</small><b>{money(total)}</b></div><div><small>إجمالي المشتريات</small><b>{money(purchaseTotal)}</b></div><div><small>إجمالي الداخل اليوم</small><b>{money(todayMovements.filter(m => m.direction === "in").reduce((s,m) => s + m.amount, 0))}</b></div><div><small>إجمالي الخارج اليوم</small><b>{money(todayMovements.filter(m => m.direction === "out").reduce((s,m) => s + m.amount, 0))}</b></div></div>
    <div className="panel bank-panel"><div className="bank-tabs"><button className={tab === "accounts" ? "active" : ""} onClick={() => setTab("accounts")}>وسائل الدفع</button><button className={tab === "movements" ? "active" : ""} onClick={() => setTab("movements")}>حركة الحسابات</button><button className={tab === "transfers" ? "active" : ""} onClick={() => setTab("transfers")}>التحويلات</button></div>
      {tab === "accounts" && <><div className="section-toolbar"><button className="primary" onClick={() => setEditing({ id: "", code: "", name: "", color: "#1677c8", icon: "wallet", isActive: true, balance: 0, income: 0, expenses: 0, purchaseTotal: 0 })}><Plus /> إضافة وسيلة</button></div><div className="account-cards">{data.paymentAccounts.map(account => <article className={!account.isActive ? "account-card inactive" : "account-card"} style={{ borderColor: account.color }} key={account.id}>{account.code === "cash" && <div className="account-icon" style={{ color: account.color, background: `${account.color}18` }}><Banknote /></div>}<span><small>{account.isActive ? "نشط" : "متوقف"}</small><strong>{account.name}</strong></span><b>{money(account.balance)}</b><div><small>المشتريات {money(account.purchaseTotal)}</small><small>الداخل {money(account.income)} · الخارج {money(account.expenses)}</small></div><button className="soft" onClick={() => setEditing(account)}>تعديل</button></article>)}</div></>}
      {tab === "movements" && <><div className="bank-filters"><select value={accountFilter} onChange={e => setAccountFilter(e.target.value)}><option value="">كل الحسابات</option>{data.paymentAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="">كل الأنواع</option>{Object.entries(movementLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="erp-table-wrap ledger-list"><table className="erp-table"><colgroup><col style={{width:"24%"}}/><col style={{width:"18%"}}/><col style={{width:"20%"}}/><col style={{width:"18%"}}/><col style={{width:"20%"}}/></colgroup><thead><tr><th>التاريخ</th><th>النوع</th><th>وسيلة الدفع</th><th>الحركة</th><th>المستند</th></tr></thead><tbody>{movements.map(m => <tr key={m.id}><td>{formatDateTime(m.occurredAt)}</td><td>{movementLabels[m.type] ?? m.type}</td><td>{name(m.paymentMethod)}</td><td className="num-cell">{m.direction === "in" ? "+" : "−"}{number(m.amount)}</td><td dir="ltr">{m.documentNumber}</td></tr>)}</tbody></table></div></>}
      {tab === "transfers" && <div className="transfer-layout"><form className="transfer-form" onSubmit={async e => { e.preventDefault(); await run({ type: "account-transfer.post", fromAccountId: from, toAccountId: to, amount: val(amount), note }, "تم التحويل بين الحسابات"); setAmount(""); setNote(""); }}><label>من الحساب<select required value={from} onChange={e => setFrom(e.target.value)}><option value="">اختر المصدر</option>{active.map(a => <option key={a.id} value={a.id}>{a.name} — {money(a.balance)}</option>)}</select></label><label>إلى الحساب<select required value={to} onChange={e => setTo(e.target.value)}><option value="">اختر الوجهة</option>{active.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>المبلغ<Num value={amount} onChange={setAmount} /></label><label>ملاحظة<input value={note} onChange={e => setNote(e.target.value)} /></label><button className="primary" disabled={!from || !to || from === to || !amount}>اعتماد التحويل</button></form><div className="erp-table-wrap transfer-list"><table className="erp-table"><colgroup><col style={{width:"24%"}}/><col style={{width:"20%"}}/><col style={{width:"20%"}}/><col style={{width:"18%"}}/><col style={{width:"18%"}}/></colgroup><thead><tr><th>التاريخ</th><th>من</th><th>إلى</th><th>المبلغ</th><th>المرجع</th></tr></thead><tbody>{data.accountTransfers.map(t => <tr key={t.id}><td>{formatDateTime(t.occurredAt)}</td><td>{name(t.fromAccountId)}</td><td>{name(t.toAccountId)}</td><td className="num-cell">{number(t.amount)}</td><td dir="ltr">{t.number}</td></tr>)}</tbody></table></div></div>}
    </div>
    {editing && <PaymentAccountDialog account={editing} close={() => setEditing(null)} run={run} />}
  </section>;
}
function PaymentAccountDialog({ account, close, run }: { account: PaymentAccount; close: () => void; run: RunCommand }) {
  const [name, setName] = useState(account.name), [color, setColor] = useState(account.color), [isActive, setActive] = useState(account.isActive);
  return <div className="modal-overlay" role="dialog" aria-modal="true"><form className="modal-card account-dialog" onSubmit={async e => { e.preventDefault(); await run({ type: account.id ? "payment-account.update" : "payment-account.create", id: account.id, name, color, isActive }, "تم حفظ وسيلة الدفع"); close(); }}><div className="section-title"><h3>{account.id ? "تعديل وسيلة الدفع" : "وسيلة دفع جديدة"}</h3><button type="button" className="icon" onClick={close}><X /></button></div><label>الاسم<input required value={name} onChange={e => setName(e.target.value)} /></label><label>اللون<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label>{account.id && <label className="active-toggle"><input type="checkbox" checked={isActive} onChange={e => setActive(e.target.checked)} /> متاحة للعمليات الجديدة</label>}<button className="primary">حفظ</button></form></div>;
}

function Parties({
  data,
  run,
  openParty,
}: {
  data: BootstrapData;
  run: RunCommand;
  openParty: (p: Party) => void;
}) {
  const [q, setQ] = useState(""),
    [name, setName] = useState(""),
    [phone, setPhone] = useState("");
  const list = [...data.parties]
    .sort((a, b) => {
      const s = q.toLowerCase();
      const score = (p: Party) =>
        p.name.toLowerCase() === s
          ? 0
          : p.name.toLowerCase().startsWith(s)
            ? 1
            : p.name.toLowerCase().includes(s)
              ? 2
              : p.phone.includes(s)
                ? 3
                : 9;
      return score(a) - score(b);
    })
    .filter(
      (p) =>
        !q || `${p.name} ${p.phone}`.toLowerCase().includes(q.toLowerCase()),
    );
  return (
    <section className="parties-workspace">
      <div className="toolbar parties-search">
        <label className="search">
          <Search />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث باسم الزبون أو المورد أو رقم الهاتف"
          />
        </label>
      </div>
      <form
        className="panel mini-form parties-create"
        onSubmit={async (e) => {
          e.preventDefault();
          await run(
            { type: "party.create", name, phone },
            "تمت إضافة الطرف كعميل ومورد تلقائيًا",
          );
          setName("");
          setPhone("");
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="اسم العميل أو المورد"
        />
        <input
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="رقم الهاتف"
        />
        <button className="primary">
          <Plus /> إضافة طرف
        </button>
      </form>
      <div className="erp-table-wrap party-grid"><table className="erp-table" aria-label="العملاء والموردون"><colgroup><col style={{width:"27%"}}/><col style={{width:"17%"}}/><col style={{width:"14%"}}/><col style={{width:"14%"}}/><col style={{width:"14%"}}/><col style={{width:"14%"}}/></colgroup><thead><tr><th>الاسم</th><th>الهاتف</th><th>لنا عليه</th><th>له علينا</th><th>الصافي</th><th>إجراء</th></tr></thead><tbody>
        {list.map((p) => <tr key={p.id} onClick={() => openParty(p)}><td className="name-cell">{p.name} <span className="party-badge">زبون ومورد</span></td><td dir="ltr">{p.phone || "—"}</td><td className="num-cell">{number(p.receivable)}</td><td className="num-cell">{number(p.payable)}</td><td className="num-cell">{number(p.receivable - p.payable)}</td><td className="action-cell"><button className="soft" onClick={event => { event.stopPropagation(); openParty(p); }}>كشف الحساب</button></td></tr>)}
      </tbody></table></div>
    </section>
  );
}
function PartyPage({
  party,
  data,
  close,
  openDoc,
  run,
}: {
  party: Party;
  data: BootstrapData;
  close: () => void;
  openDoc: (id: string) => void;
  run: RunCommand;
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [amount, setAmount] = useState(""),
    [side, setSide] = useState("receivable"),
    [paymentMethod, setPaymentMethod] = useState("cash"),
    [action, setAction] = useState("payment");
  const docs = data.documents.filter(
    (d) =>
      d.partyId === party.id &&
      (!from || d.occurredAt.slice(0, 10) >= from) &&
      (!to || d.occurredAt.slice(0, 10) <= to),
  );
  async function submit() {
    await run(
      {
        type: `${action}.post`,
        partyId: party.id,
        amount: val(amount),
        side,
        paymentMethod,
      },
      action === "offset" ? "تمت المقاصة" : "تم تسجيل العملية",
    );
    setAmount("");
  }
  return (
    <section>
      <button className="back" onClick={close}>
        ← العودة إلى الأطراف
      </button>
      <div className="panel party-summary">
        <div>
          <h2>{party.name}</h2>
          <p dir="ltr">{party.phone || "—"}</p>
        </div>
        <div className="hero-stats">
          <span>
            لنا عليه <b>{money(party.receivable)}</b>
          </span>
          <span>
            له علينا <b>{money(party.payable)}</b>
          </span>
          <span>
            الصافي <b>{money(party.net)}</b>
          </span>
          {party.receivable === 0 && party.payable === 0 && <span className="paid-badge">الحساب خالص</span>}
        </div>
      </div>
      <div className="panel form-row">
        <label>
          العملية
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="payment">تسجيل سداد</option>
            {party.receivable > 0 && party.payable > 0 && <option value="offset">مقاصة</option>}
          </select>
        </label>
        {action !== "offset" && (
          <label>
            جهة الرصيد
            <select value={side} onChange={(e) => setSide(e.target.value)}>
              <option value="receivable">الطرف دفع لنا</option>
              <option value="payable">نحن دفعنا للطرف</option>
            </select>
          </label>
        )}
        {action === "payment" && <label>طريقة الدفع<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>{data.paymentAccounts.filter(method => method.isActive).map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label>}
        <label>
          المبلغ
          <Num value={action === "offset" && !amount ? String(Math.min(party.receivable, party.payable)) : amount} onChange={setAmount} />
        </label>
        <button className="primary" onClick={() => void submit()}>
          تسجيل العملية
        </button>
      </div>
      <div className="filters">
        <label>
          من
          <input
            type="date"
            dir="ltr"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          إلى
          <input
            type="date"
            dir="ltr"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <Recent
        title="الفواتير والدفعات والتسويات"
        docs={docs}
        openDoc={openDoc}
      />
    </section>
  );
}

function Warehouses({ data, run, openDoc }: { data: BootstrapData; run: RunCommand; openDoc: (id: string) => void }) {
  const [wh, setWh] = useState(data.warehouses[0]?.id ?? ""), [q, setQ] = useState(""), [newName, setNewName] = useState(""), [managementOpen, setManagementOpen] = useState(false), [browserOpen, setBrowserOpen] = useState(false), [detailProduct, setDetailProduct] = useState<Product | null>(null), [rename, setRename] = useState(""), [movementFilter, setMovementFilter] = useState("all");
  const active = data.warehouses.find(w => w.id === wh);
  const normalized = q.trim().toLocaleLowerCase("ar");
  const qty = (product: Product) => Number(product.stocks[wh] ?? 0);
  const inventoryProducts = data.products.filter(p => qty(p) > 0);
  const products = inventoryProducts.filter(p => !normalized || `${p.name} ${p.sku} ${p.barcode}`.toLocaleLowerCase("ar").includes(normalized));
  const knownValue = inventoryProducts.reduce((sum, product) => product.lastPurchaseCost == null ? sum : sum + qty(product) * product.lastPurchaseCost, 0);
  const missingCost = inventoryProducts.filter(product => product.lastPurchaseCost == null).length;
  const totalPieces = inventoryProducts.reduce((sum, product) => sum + qty(product), 0);
  const chooseWarehouse = (value: string) => { setWh(value); setQ(""); setRename(""); setDetailProduct(null); };
  return <section className="warehouse-workspace">
    <div className="warehouse-head panel"><label>المخزن النشط<SearchableSelect value={wh} onChange={chooseWarehouse} placeholder="اختر المخزن" searchPlaceholder="ابحث عن مخزن" options={data.warehouses.map(w => ({ value: w.id, label: w.name }))} /></label><div className="warehouse-actions"><span className={active?.isSalesDefault ? "status" : "status muted-status"}>{active?.isSalesDefault ? "مخزن البيع الافتراضي" : "مخزن مسجل"}</span><button className="soft" disabled={active?.isSalesDefault} onClick={() => void run({ type: "warehouse.default", warehouseId: wh }, "تم تحديد مخزن البيع الافتراضي")}>جعله مخزن البيع الافتراضي</button><button className="primary" onClick={() => setManagementOpen(true)}>إدارة المخزن</button></div></div>
    {managementOpen && <div className="modal-overlay" role="dialog" aria-modal="true"><div className="modal-card warehouse-management"><div className="product-form-head"><div><small>إعدادات غير متكررة</small><h2>إدارة {active?.name ?? "المخزن"}</h2></div><button className="icon" aria-label="إغلاق" onClick={() => setManagementOpen(false)}><X /></button></div><div className="mini-form"><input value={newName} onChange={e => setNewName(e.target.value)} placeholder="اسم مخزن جديد"/><button className="soft" onClick={async () => { await run({ type: "warehouse.create", name: newName }, "تمت إضافة المخزن"); setNewName(""); }}><Plus /> إضافة مخزن</button><input value={rename} onChange={e => setRename(e.target.value)} placeholder={`تعديل اسم ${active?.name ?? "المخزن"}`}/><button className="soft" disabled={!active || !rename.trim()} onClick={async () => { await run({ type: "warehouse.update", id: wh, name: rename }, "تم تعديل اسم المخزن"); setRename(""); }}>حفظ اسم المخزن</button></div></div></div>}
    <div className={`panel inventory-panel${browserOpen ? " browser-open" : ""}`}>
      <div className="inventory-toolbar"><Heading title="جرد المخزن" /><div><button className="soft" onClick={() => window.print()}><Printer /> طباعة الجرد</button><button className={browserOpen ? "primary active" : "primary"} aria-expanded={browserOpen} onClick={() => { setBrowserOpen(x => !x); if (browserOpen) setDetailProduct(null); }}>{browserOpen ? "إخفاء الجرد" : "عرض الكل"}</button></div></div>
      <div className="inventory-stats"><span><small>عدد المنتجات</small><b>{number(inventoryProducts.length)}</b></span><span><small>إجمالي الأفراد</small><b>{number(totalPieces)}</b></span><span><small>القيمة المعروفة</small><b>{money(knownValue)}</b></span><span><small>بدون تكلفة فعلية</small><b>{number(missingCost)}</b></span></div>
      {browserOpen && <div className="inventory-browser"><div className="inventory-list-panel"><label className="search"><Search /><input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث بالاسم أو الكود أو الباركود" /></label><div className="erp-table-wrap warehouse-scroll inventory-body"><table className="erp-table inventory-grid" aria-label="جرد المخزن"><colgroup><col style={{width:"30%"}}/><col style={{width:"16%"}}/><col style={{width:"19%"}}/><col style={{width:"17%"}}/><col style={{width:"18%"}}/></colgroup><thead><tr><th>اسم المنتج</th><th>الرمز</th><th>سعر الشراء</th><th>الكمية الحالية</th><th>قيمة المخزون</th></tr></thead><tbody>{products.map(product => <tr className={detailProduct?.id === product.id ? "selected" : ""} key={product.id} onClick={() => { setDetailProduct(product); setMovementFilter("all"); }}><td className="name-cell">{product.name}</td><td dir="ltr">{product.sku || "—"}</td><td className="num-cell">{product.lastPurchaseCost == null ? "غير معروفة" : money(product.lastPurchaseCost)}</td><td className="num-cell">{number(qty(product))} فرد</td><td className="num-cell">{product.lastPurchaseCost == null ? "غير معروفة" : money(qty(product) * product.lastPurchaseCost)}</td></tr>)}{!products.length && <tr><td colSpan={5}>لا توجد منتجات مطابقة للبحث</td></tr>}</tbody></table></div><div className="inventory-footer"><span>{missingCost ? "قيمة المخزون المعروفة" : "قيمة المخزن الحالية"}<small>{missingCost ? `${number(missingCost)} منتجات ذات مخزون بدون سعر شراء فعلي` : "كل المنتجات ذات المخزون لها تكلفة فعلية"}</small></span><strong>{money(knownValue)}</strong></div></div>{detailProduct ? <ProductMovementPanel product={detailProduct} selectedWarehouseId={wh} data={data} filter={movementFilter} setFilter={setMovementFilter} close={() => setDetailProduct(null)} openDoc={openDoc} /> : <div className="inventory-selection-empty"><Boxes /><b>اختر منتجًا من الجرد لرؤية حركته</b><small>ستظهر هنا تفاصيل المخزون والحركات الفعلية</small></div>}</div>}
    </div>
  </section>;
}

function ProductMovementPanel({ product, selectedWarehouseId, data, filter, setFilter, close, openDoc }: { product: Product; selectedWarehouseId: string; data: BootstrapData; filter: string; setFilter: (value: string) => void; close: () => void; openDoc: (id: string) => void }) {
  const docs = data.documents.filter(document => document.status === "posted" && document.lines.some(line => line.productId === product.id));
  const amount = (kind: string) => docs.filter(document => document.kind === kind).reduce((sum, document) => sum + document.lines.filter(line => line.productId === product.id).reduce((lineSum, line) => lineSum + Number(line.quantity), 0), 0);
  const purchases = amount("purchase"), sales = amount("sale"), adjustments = amount("adjustment"), transfers = amount("transfer");
  const current = Object.values(product.stocks).reduce((sum, value) => sum + Number(value), 0), selectedQty = Number(product.stocks[selectedWarehouseId] ?? 0);
  const movementDocs = docs.filter(document => filter === "all" || document.kind === filter).sort((a,b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
  const labels: Record<string, string> = { purchase: "شراء", sale: "بيع", transfer: "تحويل", adjustment: "تصحيح", return: "إرجاع", opening: "رصيد افتتاحي" };
  const party = (document: DocumentRecord) => document.partyName || data.parties.find(p => p.id === document.partyId)?.name || (document.kind === "sale" ? "بيع مباشر" : "غير محدد");
  return <div className="product-movement-panel" aria-label={`حركة ${product.name}`}><div className="product-form-head"><div><small>تفاصيل المنتج وحركته</small><h2>{product.name}</h2></div><button className="icon" aria-label="إغلاق التفاصيل" onClick={close}><X /></button></div><div className="movement-summary"><span><small>في هذا المخزن</small><b>{number(selectedQty)} فرد</b></span><span><small>جميع المخازن</small><b>{number(current)} فرد</b></span><span><small>آخر سعر شراء فعلي</small><b>{product.lastPurchaseCost == null ? "تكلفة غير معروفة" : money(product.lastPurchaseCost)}</b></span><span><small>قيمة المنتج هنا</small><b>{product.lastPurchaseCost == null ? "تكلفة غير معروفة" : money(selectedQty * product.lastPurchaseCost)}</b></span><span><small>شراء / بيع</small><b>{number(purchases)} / {number(sales)}</b></span><span><small>تحويل / تصحيح</small><b>{number(transfers)} / {number(adjustments)}</b></span></div><div className="movement-filters">{[["all","الكل"],["purchase","شراء"],["sale","بيع"],["transfer","تحويل"],["adjustment","تصحيح"]].map(([id,label]) => <button key={id} className={filter === id ? "choice selected" : "choice"} onClick={() => setFilter(id)}>{label}</button>)}</div><div className="erp-table-wrap movement-timeline"><table className="erp-table" aria-label="سجل حركة المنتج"><colgroup><col style={{width:"17%"}}/><col style={{width:"13%"}}/><col style={{width:"27%"}}/><col style={{width:"13%"}}/><col style={{width:"14%"}}/><col style={{width:"16%"}}/></colgroup><thead><tr><th>التاريخ</th><th>العملية</th><th>الطرف / المخزن</th><th>الكمية</th><th>السعر</th><th>المستند</th></tr></thead><tbody>{movementDocs.map(document => { const line = document.lines.find(item => item.productId === product.id)!; const movement = data.movements.find(move => move.documentId === document.id && move.productId === product.id && move.warehouseId === (document.warehouseId ?? selectedWarehouseId)); const details = document.kind === "purchase" ? party(document) : document.kind === "sale" ? party(document) : document.kind === "transfer" ? `${document.warehouseName ?? "—"} ← ${document.destinationWarehouseName ?? "—"}` : `${document.warehouseName ?? movement?.warehouseName ?? "—"} · ${number(movement?.balanceBefore ?? 0)} ← ${number(movement?.balanceAfter ?? 0)} · ${document.title ?? "بدون سبب"}`; return <tr key={document.id} onClick={() => openDoc(document.id)}><td>{formatDate(document.occurredAt)}</td><td>{labels[document.kind] ?? document.kind}</td><td title={details}>{details}</td><td className="num-cell">{number(movement?.quantityDelta ?? line.quantity)}</td><td className="num-cell">{document.kind === "purchase" || document.kind === "sale" ? money(line.unitPrice) : "—"}</td><td dir="ltr">{document.number}</td></tr>})}{!movementDocs.length && <tr><td colSpan={6}>لا توجد حركات فعلية ضمن هذا الفلتر</td></tr>}</tbody></table></div></div>;
}

function Products({ data, run }: { data: BootstrapData; run: RunCommand }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<{ key: "price" | "cost" | "stock"; direction: "asc" | "desc" } | null>(null);
  const normalized = query.trim().toLocaleLowerCase("ar");
  const filteredProducts = useMemo(() => data.products.filter(product => showArchived || !product.isArchived).filter(product => !normalized || `${product.name} ${product.sku} ${product.barcode}`.toLocaleLowerCase("ar").includes(normalized)), [data.products, normalized, showArchived]);
  const stockOf = (product: Product) => Object.values(product.stocks).reduce((sum, value) => sum + Number(value), 0);
  const products = useMemo(() => !sort ? filteredProducts : [...filteredProducts].sort((a, b) => {
    const av = sort.key === "price" ? a.piecePrice : sort.key === "cost" ? a.lastPurchaseCost : stockOf(a), bv = sort.key === "price" ? b.piecePrice : sort.key === "cost" ? b.lastPurchaseCost : stockOf(b);
    if (av == null) return bv == null ? 0 : 1; if (bv == null) return -1;
    return (av - bv) * (sort.direction === "asc" ? 1 : -1);
  }), [filteredProducts, sort]);
  const toggleSort = (key: "price" | "cost" | "stock") => setSort(current => ({ key, direction: current?.key === key && current.direction === "asc" ? "desc" : "asc" }));
  const sortHeader = (id: "price" | "cost" | "stock", label: string) => <button className={sort?.key === id ? "sort-header active" : "sort-header"} onClick={() => toggleSort(id)}>{label}{sort?.key === id && <span>{sort.direction === "asc" ? "↑" : "↓"}</span>}</button>;
  const openForm = (product: Product | null) => { setEditing(product); setFormOpen(true); };
  const remove = async (product: Product) => { const stock=stockOf(product);if(stock>0){window.alert("لا يمكن حذف المنتج ولديه مخزون. صفّر المخزون أولًا من تصحيح المخزون.");return;}const historical=data.documents.some(document=>document.lines.some(line=>line.productId===product.id))||data.movements.some(movement=>movement.productId===product.id);const message=historical?"هذا المنتج مستخدم في سجلات سابقة، لذلك سيتم إخفاؤه من الاستخدام الجديد مع الاحتفاظ بتاريخه.":"سيتم حذف المنتج نهائيًا لأنه لا يملك أي سجل تاريخي.";if(window.confirm(message))await run({type:"product.delete",id:product.id},historical?"تمت أرشفة المنتج":"تم حذف المنتج"); };
  return <section className="workspace-page products-page">
    <div className="toolbar workspace-toolbar">
      <label className="search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="بحث سريع بالاسم أو الرمز أو الباركود" /></label>
      <button className="soft" aria-pressed={showArchived} onClick={() => setShowArchived(value => !value)}>{showArchived ? "إخفاء المؤرشفة" : "عرض المؤرشفة"}</button>
      <button className="primary" onClick={() => openForm(null)}><Plus /> إضافة منتج</button>
    </div>
    <div className="panel scroll-panel product-management erp-table-wrap">
      <table className="erp-table" aria-label="كل المنتجات"><colgroup><col style={{width:"12%"}}/><col style={{width:"25%"}}/><col style={{width:"12%"}}/><col style={{width:"12%"}}/><col style={{width:"14%"}}/><col style={{width:"17%"}}/></colgroup><thead><tr>
        <th>الرمز</th><th>الاسم</th><th>{sortHeader("price", "سعر البيع")}</th><th>{sortHeader("cost", "آخر شراء")}</th><th>{sortHeader("stock", "المخزون")}</th><th>إجراءات</th>
      </tr></thead><tbody>
        {products.map(product => {
          const stock = Object.values(product.stocks).reduce((sum, value) => sum + Number(value), 0);
          return <tr key={product.id}><td dir="ltr">{product.sku || "—"}</td><td className="name-cell">{product.name}{product.isArchived&&<small>مؤرشف</small>}</td><td className="num-cell">{product.piecePrice == null ? "—" : number(product.piecePrice)}</td><td className="num-cell">{product.lastPurchaseCost == null ? "—" : number(product.lastPurchaseCost)}</td><td className="num-cell">{number(stock)}</td><td className="action-cell"><button className="soft" onClick={() => openForm(product)}>تعديل</button><button className="soft" onClick={() => window.alert(`${product.name}\nالرمز: ${product.sku || "—"}\nالباركود: ${product.barcode || "—"}\nالمخزون: ${number(stock)}`)}>عرض التفاصيل</button>{!product.isArchived&&<button className="danger compact-delete" onClick={() => void remove(product)}>حذف</button>}</td></tr>;
        })}
        {!products.length && <Empty text="لا توجد منتجات مطابقة للبحث" />}
      </tbody></table>
    </div>
    {formOpen && <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={editing ? `تعديل ${editing.name}` : "إضافة منتج"}><div className="modal-card product-modal"><ProductForm run={run} product={editing} nextCode={data.nextProductCode} warehouses={data.warehouses} close={() => setFormOpen(false)} /></div></div>}
  </section>;
}

function ProductForm({
  run,
  close,
  product,
  nextCode,
  warehouses,
}: {
  run: RunCommand;
  close: () => void;
  product: Product | null;
  nextCode: number;
  warehouses: BootstrapData["warehouses"];
}) {
  const [name, setName] = useState(product?.name ?? ""),
    [cost, setCost] = useState(String(product?.pieceCost ?? "")),
    [price, setPrice] = useState(String(product?.piecePrice ?? "")),
    [openingStock, setOpeningStock] = useState(""),
    [openingWarehouseId, setOpeningWarehouseId] = useState(""),
    [barcode, setBarcode] = useState(product?.barcode ?? "");
  const barcodeInput = useRef<HTMLInputElement>(null), defaultWarehouse = warehouses.find(warehouse => warehouse.isSalesDefault);
  return (
    <form
      className="panel form-grid product-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const sensitive =
          product &&
          (name.trim() !== product.name || (cost === "" ? null : val(cost)) !== product.pieceCost);
        const confirmed = sensitive
          ? window.confirm(
              `أنت تغيّر بيانات أساسية للمنتج «${product.name}». هل تريد المتابعة؟`,
            )
          : true;
        if (!confirmed) return;
        await run(
          {
            type: product ? "product.update" : "product.create",
            id: product?.id,
            name,
            pieceCost: cost,
            piecePrice: price,
            openingStock: product ? undefined : openingStock,
            openingWarehouseId: product ? undefined : openingWarehouseId,
            barcode,
            confirmSensitive: confirmed,
          },
          product ? "تم تعديل المنتج" : "تم إنشاء المنتج",
        );
        close();
      }}
    >
      <div className="product-form-head"><div><small>{product ? "بيانات المنتج" : "منتج جديد"}</small><h2>{product ? "تعديل المنتج" : "إضافة منتج جديد"}</h2></div><button type="button" className="icon" aria-label="إغلاق" onClick={close}><X /></button></div>
      <label>
        اسم المنتج
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        سعر الشراء للفرد
        <Num value={cost} onChange={setCost} />
      </label>
      <label>
        سعر البيع للفرد
        <Num value={price} onChange={setPrice} />
      </label>
      {!product && <label>رصيد البداية<Num value={openingStock} onChange={setOpeningStock} /></label>}
      {!product && val(openingStock) > 0 && (defaultWarehouse ? <p className="note-hint">رصيد البداية سيدخل إلى: {defaultWarehouse.name}</p> : <label>مخزن رصيد البداية<SearchableSelect value={openingWarehouseId} onChange={setOpeningWarehouseId} placeholder="اختر المخزن" searchPlaceholder="ابحث عن مخزن" options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} /></label>)}
      <label className="product-code-preview">
        رمز المنتج
        <input dir="ltr" readOnly aria-readonly="true" value={product?.sku || nextCode} />
      </label>
      <label className="barcode-field">
        الباركود
        <input
          ref={barcodeInput}
          dir="ltr"
          autoComplete="off"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }}
        />
        <button type="button" className="soft" onClick={() => barcodeInput.current?.focus()}>مسح الباركود</button>
      </label>
      <div className="product-form-actions"><button type="button" className="soft" onClick={close}>إلغاء</button><button className="primary">
        {product ? "حفظ التعديلات" : "حفظ المنتج"}
      </button></div>
    </form>
  );
}

function MultiStockForm({
  data,
  mode,
  run,
  openDoc,
  prefill,
  clearPrefill,
}: {
  data: BootstrapData;
  mode: "transfer" | "adjust";
  run: RunCommand;
  openDoc: (id: string) => void;
  prefill?: AdjustmentPrefill | null;
  clearPrefill?: () => void;
}) {
  const [from, setFrom] = useSessionDraft(`${mode}-from`, prefill?.warehouseId ?? ""),
    [to, setTo] = useSessionDraft(`${mode}-to`, ""),
    [q, setQ] = useState(""),
    [reason, setReason] = useSessionDraft(`${mode}-reason`, ""),
    [lines, setLines] = useSessionDraft<DraftLine[]>(`${mode}-lines`, (() => {
      const product = data.products.find((item) => item.id === prefill?.productId);
      return product ? [lineFor(product)] : [];
    })());
  useEffect(() => {
    if (mode !== "adjust" || !prefill) return;
    const product = data.products.find(item => item.id === prefill.productId);
    setFrom(prefill.warehouseId);
    setLines(product ? [{ ...lineFor(product), actualQuantity: "", unitPrice: "" }] : []);
    setReason("");
  }, [data.products, mode, prefill, setFrom, setLines, setReason]);
  async function submit() {
    const body =
      mode === "transfer"
        ? {
            type: "transfer.post",
            fromWarehouseId: from,
            toWarehouseId: to,
            lines: lines.map((l) => ({
              productId: l.productId,
              quantity: val(l.quantity),
            })),
          }
        : {
            type: "adjustment.post",
            warehouseId: from,
            reason,
            lines: lines.map((l) => ({
              productId: l.productId,
              actualQuantity: val(l.actualQuantity),
              purchaseCost: l.unitPrice === "" ? null : val(l.unitPrice),
            })),
          };
    const id = await run(
      body,
      mode === "transfer" ? "تم التحويل بين المخازن" : "تم تسجيل تصحيح المخزون",
    );
    setLines([]);
    setReason("");
    setQ("");
    if (mode === "adjust") clearPrefill?.();
    openDoc(id);
  }
  const invalidAdjustment = mode === "adjust" && lines.some(line => {
    const product = data.products.find(item => item.id === line.productId);
    const before = Number(product?.stocks[from] ?? 0);
    return line.actualQuantity === "" || (val(line.actualQuantity) > before && product?.lastPurchaseCost == null && val(line.unitPrice) <= 0);
  });
  return (
    <div className="panel form-stack stock-operation-panel">
      <div className="form-row">
        <label>
          {mode === "transfer" ? "من" : "المخزن"}
          <SearchableSelect value={from} onChange={setFrom} placeholder="اختر المخزن" searchPlaceholder="ابحث عن مخزن" options={data.warehouses.map(w => ({ value: w.id, label: w.name }))} />
        </label>
        {mode === "transfer" && (
          <label>
            إلى
            <SearchableSelect value={to} onChange={setTo} placeholder="اختر الوجهة" searchPlaceholder="ابحث عن مخزن الوجهة" options={data.warehouses.filter(w => w.id !== from).map(w => ({ value: w.id, label: w.name }))} />
          </label>
        )}
      </div>
      <SearchProducts
        data={data}
        query={q}
        setQuery={setQ}
        onPick={(p) => {
          setLines((x) =>
            x.some((l) => l.productId === p.id) ? x : [...x, mode === "adjust" ? { ...lineFor(p), unitPrice: "" } : lineFor(p)],
          );
          setQ("");
        }}
      />
      <div className="stock-draft" aria-label="المنتجات الجاري تنفيذ العملية عليها">{lines.map((l) => (
        <LineEditor
          key={l.productId}
          line={l}
          product={data.products.find((p) => p.id === l.productId)!}
          mode={mode}
          availableStock={mode === "adjust" ? Number(data.products.find((p) => p.id === l.productId)?.stocks[from] ?? 0) : undefined}
          onChange={(x) =>
            setLines((s) => s.map((a) => (a.productId === x.productId ? x : a)))
          }
          onRemove={() =>
            setLines((s) => s.filter((a) => a.productId !== l.productId))
          }
        />
      ))}{!lines.length && <Empty text={mode === "transfer" ? "أضف المنتجات إلى مسودة التحويل" : "اختر منتجًا لتسجيل رصيده الفعلي"} />}</div>
      {mode === "adjust" && (
        <label>سبب التصحيح<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: نتيجة الجرد الفعلي" /></label>
      )}
      <button
        className="primary stock-primary-action"
        disabled={!from || (mode === "transfer" && !to) || !lines.length || (mode === "adjust" && (!reason.trim() || invalidAdjustment))}
        onClick={() => void submit()}
      >
        {mode === "transfer" ? "اعتماد التحويل" : "اعتماد التصحيح"}
      </button>
    </div>
  );
}
function Transfer(p: {
  data: BootstrapData;
  run: RunCommand;
  openDoc: (id: string) => void;
}) {
  const transfers = p.data.documents.filter((document) => document.kind === "transfer");
  return (
    <section className="stock-workspace">
      <div className="stock-workspace-main"><Heading title="تحويل مرن بين أي مخزنين" />
      <MultiStockForm {...p} mode="transfer" /></div>
      <div className="panel records transfer-history"><Heading title="سجل التحويلات" /><div className="erp-table-wrap transfer-list"><table className="erp-table" aria-label="سجل التحويلات"><colgroup><col style={{width:"20%"}}/><col style={{width:"24%"}}/><col style={{width:"20%"}}/><col style={{width:"20%"}}/><col style={{width:"16%"}}/></colgroup><thead><tr><th>التاريخ</th><th>المستند</th><th>من</th><th>إلى</th><th>الكمية</th></tr></thead><tbody>{transfers.map(document => <tr key={document.id} onClick={() => p.openDoc(document.id)}><td>{formatDate(document.occurredAt)}</td><td dir="ltr">{document.number}</td><td>{document.warehouseName ?? "—"}</td><td>{document.destinationWarehouseName ?? "—"}</td><td className="num-cell">{number(document.lines.reduce((sum, line) => sum + Number(line.quantity), 0))}</td></tr>)}{!transfers.length && <tr><td colSpan={5}>لا توجد تحويلات مسجلة</td></tr>}</tbody></table></div></div>
    </section>
  );
}
function Adjustment(p: {
  data: BootstrapData;
  run: RunCommand;
  openDoc: (id: string) => void;
  prefill?: AdjustmentPrefill | null;
  clearPrefill?: () => void;
}) {
  return (
    <section className="stock-workspace adjustment-workspace">
      <div className="stock-workspace-main"><Heading title="تصحيح المخزون بالجرد الفعلي" />
      <MultiStockForm {...p} mode="adjust" /></div>
      <Recent
        title="سجل التصحيحات"
        docs={p.data.documents.filter((d) => d.kind === "adjustment")}
        openDoc={p.openDoc}
      />
    </section>
  );
}
function Records({
  data,
  openDoc,
}: {
  data: BootstrapData;
  openDoc: (id: string) => void;
}) {
  const [kind, setKind] = useState("sale"),
    [q, setQ] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const docs = data.documents.filter(
    (d) =>
      (!kind || d.kind === kind) &&
      (!q ||
        `${d.number} ${d.partyName ?? ""} ${d.title ?? ""}`
          .toLowerCase()
          .includes(q.toLowerCase())) &&
      (!from || d.occurredAt.slice(0, 10) >= from) &&
      (!to || d.occurredAt.slice(0, 10) <= to),
  );
  return (
    <section>
      <div className="filters">
        <label className="search">
          <Search />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="رقم المستند أو الطرف"
          />
        </label>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">كل المعاملات</option>
          {Object.entries(kindLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label className="date-filter"><span>تاريخ من</span><input
          type="date" dir="ltr" value={from}
          onChange={(e) => setFrom(e.target.value)}
        /></label>
        <label className="date-filter"><span>تاريخ إلى</span><input
          type="date" dir="ltr" value={to}
          onChange={(e) => setTo(e.target.value)}
        /></label>
      </div>
      <Recent title="كل السجلات القابلة للتتبع" docs={docs} openDoc={openDoc} />
    </section>
  );
}
const reportNames: Record<ReportType,string> = { overview:"الملخص الشامل",sales:"حركة المبيعات",purchases:"حركة المشتريات","product-sales":"تحليل مبيعات الأصناف",stock:"حركة المخزون",profit:"تحليل الأرباح",debts:"الحسابات والديون","party-ledger":"كشف حساب طرف",financial:"الحركة المالية",expenses:"المصاريف",returns:"المرتجعات" };
const reportColumns = (type: ReportType, productId: string, groupBy: string): Array<[string,string]> => ({
 overview:[["date","التاريخ"],["sales","المبيعات"],["purchases","المشتريات"],["expenses","المصاريف"],["received","المقبوض"],["paid","المدفوع"],["net","صافي الحركة"]],
 sales:productId?[["number","رقم الفاتورة"],["occurredAt","التاريخ"],["product","المنتج"],["quantity","الكمية"],["unitPrice","سعر البيع"],["cost","تكلفة الشراء"],["profit","الربح"]]:[["number","رقم الفاتورة"],["occurredAt","التاريخ"],["party","العميل / بيع مباشر"],["total","قيمة البيع"],["cost","تكلفة الشراء"],["profit","الربح"]],
 purchases:productId?[["number","رقم الفاتورة"],["occurredAt","التاريخ"],["party","المورد"],["product","المنتج"],["quantity","الكمية"],["unitPrice","سعر الشراء"],["total","إجمالي المنتج"]]:[["number","رقم الفاتورة"],["occurredAt","التاريخ"],["party","المورد"],["paymentMethod","طريقة التسوية"],["total","الإجمالي"],["paid","المدفوع"],["due","المستحق"]],
 "product-sales":[["sku","رمز المنتج"],["product","اسم المنتج"],["soldQuantity","الكمية المباعة"],["returnedQuantity","المرتجع"],["netQuantity","صافي الكمية"],["sales","إجمالي المبيعات"],["returns","قيمة المرتجعات"],["netSales","صافي المبيعات"],["averagePrice","متوسط سعر البيع"],["profit","الربح"]],
 stock:[["occurredAt","التاريخ"],["sku","الرمز"],["product","المنتج"],["warehouse","المخزن"],["movementType","العملية"],["before","قبل"],["change","التغيير"],["after","بعد"],["documentNumber","المستند"]],
 profit:groupBy==="product"?[["product","اسم المنتج"],["quantity","الكمية"],["revenue","صافي المبيعات"],["cost","التكلفة"],["profit","الربح"],["margin","الهامش %"],["invoiceCount","عدد الفواتير"]]:[["number","رقم الفاتورة"],["occurredAt","التاريخ"],["revenue","صافي المبيعات"],["cost","التكلفة"],["profit","الربح"],["margin","الهامش %"]],
 debts:[["name","اسم الطرف"],["phone","الهاتف"],["receivable","لنا عليه"],["payable","له علينا"],["net","الصافي"],["lastMovement","آخر حركة"]],
 "party-ledger":[["occurredAt","التاريخ"],["movementType","نوع العملية"],["documentNumber","رقم المستند"],["description","البيان"],["debit","مدين"],["credit","دائن"],["paymentMethod","وسيلة الدفع"]],
 financial:[["occurredAt","التاريخ"],["paymentMethod","وسيلة الدفع"],["movementType","نوع العملية"],["incoming","داخل"],["outgoing","خارج"],["party","الطرف"],["documentNumber","المستند"]],
 expenses:[["occurredAt","التاريخ"],["title","عنوان المصروف"],["recurring","النوع"],["paymentMethod","وسيلة الدفع"],["total","المبلغ"],["number","المستند"]],
 returns:[["occurredAt","التاريخ"],["number","مرجع الإرجاع"],["originalDocument","الفاتورة الأصلية"],["party","العميل"],["products","عدد الأصناف"],["quantity","الكمية"],["total","قيمة الإرجاع"]]
} as Record<ReportType,Array<[string,string]>>)[type];
const movementLabels: Record<string,string>={sale:"بيع",purchase:"شراء","sale-return":"إرجاع بيع","transfer-in":"تحويل داخل","transfer-out":"تحويل خارج",adjustment:"تصحيح مخزون",opening:"رصيد بداية",expense:"مصروف","party-receipt":"تحصيل من طرف","party-payment":"دفع لطرف",payment:"دفعة",settlement:"تسوية",offset:"مقاصة",return:"إرجاع"};
const summarySchema: Record<ReportType,Array<[string,string]>>={sales:[["netSales","صافي المبيعات"],["cost","تكلفة الشراء"],["profit","الربح"]],purchases:[["total","إجمالي المشتريات"],["quantity","إجمالي الكمية"],["count","عدد الفواتير"]],"product-sales":[["sales","صافي المبيعات"],["quantity","صافي الكمية"],["profit","الربح"]],profit:[["revenue","صافي المبيعات"],["cost","التكلفة"],["profit","الربح"]],returns:[["total","قيمة المرتجعات"],["quantity","الكمية"]],stock:[["incoming","الداخل"],["outgoing","الخارج"],["movements","عدد الحركات"]],debts:[["receivable","لنا عليه"],["payable","له علينا"],["net","الصافي"]],"party-ledger":[["receivable","لنا عليه"],["payable","له علينا"],["net","الصافي"]],financial:[["incoming","الداخل"],["outgoing","الخارج"],["net","الصافي"]],expenses:[["total","إجمالي المصاريف"],["count","العدد"]],overview:[["sales","المبيعات"],["purchases","المشتريات"],["expenses","المصاريف"],["profit","الربح"]]};
function Reports({ data, openDoc, type }: { data: BootstrapData; openDoc: (id: string) => void; type: ReportType }) {
  const now=new Date(),[from,setFrom]=useState(`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,"0")}-01`),[to,setTo]=useState(now.toISOString().slice(0,10)),[partyId,setPartyId]=useState(""),[productId,setProductId]=useState(""),[accountId,setAccountId]=useState(""),[groupBy,setGroupBy]=useState("invoice"),[sortBy,setSortBy]=useState("quantity"),[movementType,setMovementType]=useState(""),[direction,setDirection]=useState(""),[debtSide,setDebtSide]=useState(""),[search,setSearch]=useState(""),[page,setPage]=useState(1),[result,setResult]=useState<ReportResponse|null>(null),[busy,setBusy]=useState(false),[reportError,setReportError]=useState("");
  const runReport=async(nextPage=1)=>{setBusy(true);setReportError("");const q=new URLSearchParams({type,page:String(nextPage),pageSize:"100"});if(type!=="debts"){q.set("from",from);q.set("to",to)}const add=(key:string,value:string)=>{if(value)q.set(key,value)};if(["sales","purchases","product-sales","profit","returns","stock"].includes(type))add("productId",productId);if(type==="party-ledger")add("partyId",partyId);if(["sales","purchases","financial","expenses"].includes(type))add("paymentAccountId",accountId);if(type==="profit")add("groupBy",groupBy);if(type==="product-sales")add("sortBy",sortBy);if(type==="stock")add("movementType",movementType);if(type==="financial")add("direction",direction);if(type==="debts"){add("debtSide",debtSide);add("search",search)}try{const r=await fetch(`/api/reports?${q}`),j=await r.json();if(!r.ok)throw new Error(j.error);setResult(j);setPage(nextPage)}catch(e){setReportError(e instanceof Error?e.message:"تعذر إنشاء التقرير")}finally{setBusy(false)}};
  const productOptions=data.products.map(p=>({value:p.id,label:`${p.sku||"—"} — ${p.name}`,search:`${p.name} ${p.sku??""} ${p.barcode??""}`})),accountName=(id:unknown)=>data.paymentAccounts.find(a=>a.id===id||a.code===id)?.name??(id?"حساب غير متاح":"—"),columns=reportColumns(type,productId,groupBy),showDates=type!=="debts";
  const hasUnknownCost=Boolean(result&&Number(result.summary.unknownRevenue)>0&&["sales","product-sales","profit","overview"].includes(type));
  const numericKeys=new Set(["quantity","unitPrice","total","cost","profit","margin","paid","due","sales","purchases","expenses","received","net","soldQuantity","returnedQuantity","netQuantity","returns","netSales","averagePrice","invoiceCount","before","change","after","incoming","outgoing","receivable","payable","debit","credit","products"]);
  const display=(key:string,value:unknown)=>{if(numericKeys.has(key))return number(reportNumber(value));if(key==="paymentMethod")return accountName(value);if(key==="movementType")return movementLabels[String(value)]??"عملية غير معروفة";if(key==="occurredAt"||key==="lastMovement")return value?formatDateTime(String(value)):"—";if(key==="date")return value?formatDate(String(value)):"—";if(typeof value==="number")return number(reportNumber(value));if(typeof value==="boolean")return value?"متكرر":"مرة واحدة";return String(value??"—")};
  const summaryValue=(_key:string,value:unknown)=>number(reportNumber(value));
  return <section className="reports-workspace" onKeyDown={e=>{if(e.key==="Enter")void runReport(1)}}><div className="report-toolbar no-print">{showDates&&<><label>من<input type="date" dir="ltr" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>إلى<input type="date" dir="ltr" value={to} onChange={e=>setTo(e.target.value)}/></label></>}<button className="primary" onClick={()=>void runReport(1)}>عرض</button><button onClick={()=>window.print()}><Printer/> طباعة</button></div><div className="report-filters no-print">
  {["sales","purchases","product-sales","profit","returns","stock"].includes(type)&&<SearchableSelect value={productId} onChange={setProductId} options={productOptions} placeholder="كل المنتجات" searchPlaceholder="ابحث بالاسم أو الرمز أو الباركود" allowEmpty/>}
  {type==="party-ledger"&&<SearchableSelect value={partyId} onChange={setPartyId} options={data.parties.map(p=>({value:p.id,label:p.name,search:p.phone}))} placeholder="اختر الطرف (مطلوب)" searchPlaceholder="ابحث بالاسم أو الهاتف"/>}
  {["sales","purchases","financial","expenses"].includes(type)&&<select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">كل وسائل الدفع</option>{data.paymentAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>}
  {type==="profit"&&<select value={groupBy} onChange={e=>setGroupBy(e.target.value)}><option value="invoice">حسب الفاتورة</option><option value="product">حسب المنتج</option></select>}{type==="product-sales"&&<select value={sortBy} onChange={e=>setSortBy(e.target.value)}><option value="quantity">الأعلى كمية</option><option value="sales">الأعلى مبيعات</option><option value="profit">الأعلى ربحًا</option><option value="name">الاسم</option></select>}
  {type==="stock"&&<select value={movementType} onChange={e=>setMovementType(e.target.value)}><option value="">كل الحركات</option>{Object.entries(movementLabels).filter(([k])=>["sale","purchase","sale-return","transfer-in","transfer-out","adjustment","opening"].includes(k)).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select>}{type==="financial"&&<select value={direction} onChange={e=>setDirection(e.target.value)}><option value="">داخل وخارج</option><option value="in">داخل</option><option value="out">خارج</option></select>}{type==="debts"&&<><select value={debtSide} onChange={e=>setDebtSide(e.target.value)}><option value="">الجميع</option><option value="receivable">لنا عليه</option><option value="payable">له علينا</option><option value="clear">حساب خالص</option></select><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث بالاسم أو الهاتف"/></>}
  </div><div className="print-report-title"><h2>{reportNames[type]}</h2>{showDates&&<span>من {formatDate(from)} إلى {formatDate(to)}</span>}</div>{reportError&&<div className="error report-error">{reportError}</div>}{result&&<div className="report-summary-area"><div className="report-kpis">{summarySchema[type].flatMap(([key,label])=>Object.hasOwn(result.summary,key)?[<span className="report-kpi" key={key}><small>{label}</small><b>{summaryValue(key,result.summary[key])}</b></span>]:[])}</div>{hasUnknownCost&&<p className="report-cost-note">بعض السجلات القديمة لا تحتوي تكلفة محفوظة وتم احتساب تكلفتها بصفر.</p>}</div>}<div className="report-body">{busy&&<div className="report-loading">جاري إعداد التقرير…</div>}{result&&<div className="erp-table-wrap"><table className={`erp-table report-table report-table-${type}`}><colgroup>{type==="sales"&&(productId?<><col style={{width:"5%"}}/><col style={{width:"17%"}}/><col style={{width:"18%"}}/><col style={{width:"18%"}}/><col style={{width:"10%"}}/><col style={{width:"11%"}}/><col style={{width:"11%"}}/><col style={{width:"10%"}}/></>:<><col style={{width:"5%"}}/><col style={{width:"18%"}}/><col style={{width:"18%"}}/><col style={{width:"20%"}}/><col style={{width:"13%"}}/><col style={{width:"13%"}}/><col style={{width:"13%"}}/></>)}</colgroup><thead><tr><th className="serial">م</th>{columns.map(c=><th key={c[0]}>{c[1]}</th>)}</tr></thead><tbody>{result.rows.map((row,i)=><tr key={String(row.id??i)} onClick={()=>row.documentId&&openDoc(String(row.documentId))}><td className="num-cell">{number((page-1)*100+i+1)}</td>{columns.map(([key])=><td key={key} title={key==="number"?String(row[key]??""):undefined} className={`${numericKeys.has(key)||typeof row[key]==="number"?"num-cell ":""}${key==="occurredAt"?"date-cell":""}`}>{display(key,row[key])}</td>)}</tr>)}</tbody></table></div>}</div>{result&&<div className="report-pagination no-print"><span>{result.meta.totalRows?number(Math.min((page-1)*100+1,result.meta.totalRows)):"0"}–{number(Math.min(page*100,result.meta.totalRows))} من {number(result.meta.totalRows)}</span><button disabled={page<=1||busy} onClick={()=>void runReport(page-1)}>السابق</button><button disabled={page>=result.meta.totalPages||busy} onClick={()=>void runReport(page+1)}>التالي</button></div>}</section>;
}
function DocumentDetail({
  document,
  data,
  close,
  run,
}: {
  document: DocumentRecord;
  data: BootstrapData;
  close: () => void;
  run: RunCommand;
}) {
  const [returning, setReturning] = useState(false),
    [returns, setReturns] = useState<Record<string, string>>({});
  function download() {
    const content = [
      `${kindLabels[document.kind]} ${document.number}`,
      `التاريخ: ${document.occurredAt}`,
      `الطرف: ${document.partyName ?? "—"}`,
      `المخزن: ${document.warehouseName ?? "—"}`,
      ...document.lines.map(
        (l) =>
          `${l.description} | ${l.quantity} × ${l.unitPrice} = ${l.lineTotal}`,
      ),
      `الإجمالي: ${document.total} MRU`,
    ].join("\n");
    const a = window.document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    a.download = `${document.number}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <section>
      <div className="doc-actions">
        <button className="back" onClick={close}>
          ← العودة
        </button>
        <button className="soft" onClick={() => window.print()}>
          <Printer /> طباعة
        </button>
        <button className="soft" onClick={download}>
          تنزيل
        </button>
        {document.kind === "sale" && (
          <button className="warn" onClick={() => setReturning(!returning)}>
            <RotateCcw /> إرجاع جزئي
          </button>
        )}
      </div>
      <article className="document">
        <div className="document-head">
          <div>
            <span>{kindLabels[document.kind]}</span>
            <h2>{document.number}</h2>
            <small>{document.occurredAt}</small>
          </div>
          <b>{document.status === "posted" ? "معتمد" : document.status}</b>
        </div>
        <div className="doc-meta">
          <span>
            الطرف <b>{document.partyName ?? "—"}</b>
          </span>
          <span>
            المخزن <b>{document.warehouseName ?? "—"}</b>
          </span>
          {document.destinationWarehouseName && (
            <span>
              الوجهة <b>{document.destinationWarehouseName}</b>
            </span>
          )}
          <span>
            طريقة الدفع <b>{document.paymentMethod ?? "—"}</b>
          </span>
        </div>
        <div className="erp-table-wrap"><table className="erp-table document-lines"><colgroup><col style={{width:"46%"}}/><col style={{width:"16%"}}/><col style={{width:"18%"}}/><col style={{width:"20%"}}/></colgroup>
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الكمية</th>
              <th>السعر</th>
              <th>المجموع</th>
            </tr>
          </thead>
          <tbody>
            {document.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td>{quantity(l.quantity)}</td>
                <td>{money(l.unitPrice)}</td>
                <td>{money(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="document-total">
          <span>الإجمالي</span>
          <strong>{money(document.total)}</strong>
        </div>
        {document.dueTotal > 0 && (
          <div className="due">
            <span>المستحق الأصلي {money(document.dueTotal)}</span>
            <span>المسوّى {money(document.paidTotal)}</span>
            <b>
              المتبقي{" "}
              {money(Math.max(0, document.dueTotal - document.paidTotal))}
            </b>
          </div>
        )}
      </article>
      {returning && (
        <div className="panel">
          <h3>حدد الكميات المرتجعة</h3>
          {document.lines
            .filter((l) => l.productId)
            .map((l) => (
              <label className="return-line" key={l.id}>
                <span>
                  {l.description} — المباع {number(l.quantity)}
                </span>
                <Num
                  value={returns[l.productId!] ?? ""}
                  onChange={(v) =>
                    setReturns((x) => ({ ...x, [l.productId!]: v }))
                  }
                />
              </label>
            ))}
          <button
            className="primary"
            onClick={async () => {
              await run(
                {
                  type: "sale.return",
                  saleId: document.id,
                  lines: Object.entries(returns)
                    .filter(([, v]) => val(v) > 0)
                    .map(([productId, v]) => ({ productId, quantity: val(v) })),
                },
                "تم الإرجاع وتحديث المخزون والحساب",
              );
              close();
            }}
          >
            اعتماد الإرجاع
          </button>
        </div>
      )}
      <Linked document={document} data={data} />
    </section>
  );
}
function Linked({
  document,
  data,
}: {
  document: DocumentRecord;
  data: BootstrapData;
}) {
  const linked = data.documents.filter(
    (d) =>
      d.parentDocumentId === document.id || d.id === document.parentDocumentId,
  );
  return linked.length ? (<div className="panel"><Heading title="المعاملات المرتبطة" /><div className="erp-table-wrap"><table className="erp-table"><colgroup><col style={{width:"34%"}}/><col style={{width:"36%"}}/><col style={{width:"30%"}}/></colgroup><thead><tr><th>المعاملة</th><th>المستند</th><th>المبلغ</th></tr></thead><tbody>{linked.map(d => <tr key={d.id}><td>{kindLabels[d.kind]}</td><td dir="ltr">{d.number}</td><td className="num-cell">{number(d.total)}</td></tr>)}</tbody></table></div></div>) : null;
}

function InvoiceQuickBrowser({ title, docs, openDoc }: { title: string; docs: DocumentRecord[]; openDoc: (id: string) => void }) {
  const localDay = (value: Date | string) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
  const today = localDay(new Date()), [from, setFrom] = useState(today), [to, setTo] = useState(today);
  const ranged = from !== to;
  const visible = docs.filter(document => { const day = document.businessDate ?? localDay(document.occurredAt); return day >= from && day <= to; });
  return <aside className="panel quick-invoices" aria-label={title}><div className="quick-invoice-head"><h3>{title}</h3><div className="history-dates"><label>من<input type="date" dir="ltr" value={from} onChange={event => setFrom(event.target.value)} /></label><label>إلى<input type="date" dir="ltr" value={to} onChange={event => setTo(event.target.value)} /></label></div></div><div className="erp-table-wrap quick-invoice-list"><table className="erp-table"><colgroup><col style={{width:"30%"}}/><col style={{width:"44%"}}/><col style={{width:"26%"}}/></colgroup><thead><tr><th>الرقم</th><th>العميل / النوع</th><th>المبلغ</th></tr></thead><tbody>{visible.slice(0,100).map(document => { const note = document.paymentMethod === "note"; const heading = note ? document.partyName ?? "عميل غير محدد" : ranged ? document.number : document.dailySequence ? `رقم ${number(document.dailySequence)}` : document.number; return <tr key={document.id} onClick={() => openDoc(document.id)}><td dir={note ? "rtl" : "ltr"}>{heading}</td><td>{ranged && document.dailySequence ? `رقم اليوم: ${number(document.dailySequence)} · ` : ""}{note ? document.number : document.partyName ?? "دفع مباشر"}</td><td className="num-cell">{number(document.total)}</td></tr>;})}{!visible.length && <tr><td colSpan={3}>لا توجد فواتير في هذه الفترة</td></tr>}</tbody></table></div></aside>;
}

function Recent({
  title,
  docs,
  openDoc,
  dateFilter = false,
}: {
  title: string;
  docs: DocumentRecord[];
  openDoc: (id: string) => void;
  dateFilter?: boolean;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const localDate = (iso: string) => {
    const date = new Date(iso);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const today = localDate(new Date().toISOString());
  const visibleDocs = dateFilter
    ? docs.filter((document) => {
        const occurredOn = localDate(document.occurredAt);
        if (!from && !to) return occurredOn === today;
        return (!from || occurredOn >= from) && (!to || occurredOn <= to);
      })
    : docs;
  return (<div className="panel records recent-table"><Heading title={title} />{dateFilter && <div className="filters recent-date-filters"><label>من تاريخ<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>إلى تاريخ<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label></div>}<div className="erp-table-wrap"><table className="erp-table"><colgroup><col style={{width:"18%"}}/><col style={{width:"20%"}}/><col style={{width:"16%"}}/><col style={{width:"22%"}}/><col style={{width:"12%"}}/><col style={{width:"12%"}}/></colgroup><thead><tr><th>التاريخ</th><th>المستند</th><th>النوع</th><th>الطرف</th><th>الحالة</th><th>المبلغ</th></tr></thead><tbody>{visibleDocs.slice(0,100).map(d => <tr key={d.id} onClick={() => openDoc(d.id)}><td>{formatDateTime(d.occurredAt)}</td><td dir="ltr">{d.number}</td><td>{kindLabels[d.kind]}</td><td className="name-cell">{d.partyName ?? d.title ?? "—"}</td><td>{d.dueTotal > 0 && d.paidTotal < d.dueTotal ? "مستحق" : "معتمد"}</td><td className="num-cell">{number(d.total)}</td></tr>)}{!visibleDocs.length && <tr><td colSpan={6}>لا توجد فواتير ضمن الفترة المحددة</td></tr>}</tbody></table></div></div>);
}
function Heading({ title }: { title: string }) {
  return (
    <div className="heading">
      <h2>{title}</h2>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function InlineCreate({
  label,
  onSave,
}: {
  label: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [v, setV] = useState("");
  return (
    <div className="mini-form">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={label}
      />
      <button className="primary" onClick={() => void onSave(v)}>
        حفظ
      </button>
    </div>
  );
}
