# Conta Offline

نسخة سطح مكتب محلية من نظام Conta للمحاسبة ونقاط البيع، لويندوز 10/11 ‏x64. يعمل التطبيق من مُثبّت واحد، بلا إنترنت وبلا MongoDB أو Node.js أو PM2 أو Nginx أو Docker أو إعداد `.env`.

## الاستخدام

ثبّت `release/Conta-Offline-Setup-x64.exe` ثم افتح **Conta Offline** من سطح المكتب أو قائمة Start. لا توجد شاشة كلمة مرور. تحفظ البيانات في:

```text
%LOCALAPPDATA%\Conta Offline\
  data\conta.db
  backups\
  imports\
  logs\conta.log
  temp\
```

لا يحذف إلغاء التثبيت العادي قاعدة البيانات أو النسخ الاحتياطية. ينشئ التشغيل الأول المخزن الرئيسي ووسائل الدفع تلقائيًا. يستمع الخادم الداخلي إلى `127.0.0.1` فقط.

## التطوير والإصدار

يتطلب التطوير Node.js 22.13+ فقط (ليس مطلوبًا عند العميل):

```bash
npm ci
npm run dev
npm test
npm run lint
npm run build
npm run desktop:dev
npm run desktop:build
npm run dist:win
```

ينشئ `npm run dist:win` الملف `release/Conta-Offline-Setup-x64.exe`. التطبيق المعبأ يتضمن Next standalone وElectron وSQLite وملف `sql.js` WASM.

## النسخ والترحيل

يصدر Offline نسخة منطقية `conta-backup` v2. كما يقبل الاستعادة من نسخة Conta Online القديمة v1/Mongo Extended JSON. لنقل البيانات: أنشئ النسخة الاعتيادية في Conta Online، انقل الملف إلى جهاز ويندوز، ثم اختر الاستعادة داخل Conta Offline. لا يتصل Offline بـAtlas.

استيراد DataAcc SQLite يعمل محليًا: اختر الملف، عاينه، ثم نفّذ الاستيراد. ينشئ النظام نسخة أمان قبل الاستعادة أو الاستيراد.

راجع [معمارية Offline](docs/OFFLINE-ARCHITECTURE.md) و[اختبار ويندوز اليدوي](docs/WINDOWS-SMOKE-TEST.md).
