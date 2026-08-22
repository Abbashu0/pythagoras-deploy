# Pythagoras

واجهة محلية لمنصة فيثاغورس: تطبيق الطالب ولوحة الإدارة.

## التشغيل على Windows

المتطلبات: Node.js 22 أو أحدث وnpm.

```powershell
npm install
npm run dev
```

افتح `http://localhost:3000` لتطبيق الطالب، أو `http://localhost:3000/admin` للإدارة.

لتحديد مكان بيانات SQLite المحلية اختياريًا:

```powershell
$env:PYTHAGORAS_DATA_DIR = "D:\PythagorasData"
```

عند عدم تحديده على Windows يستخدم المشروع `%LOCALAPPDATA%\Pythagoras\data`.

التحقق:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```
