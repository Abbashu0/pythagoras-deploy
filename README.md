# Pythagoras

Backend وAdmin لمنصة فيثاغورس. تطبيق الطالب الحقيقي موجود في `mobile/`.

## التشغيل على Windows

المتطلبات: Node.js 22 أو أحدث وnpm.

```powershell
npm install
npm run dev
```

افتح `http://localhost:3000/admin` للوصول إلى لوحة الإدارة. المسار `/` يعيد التوجيه إليها.

لتشغيل تطبيق الطالب Mobile:

```powershell
cd mobile
npx expo start --lan
```

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
