---
type: encyclopedia
status: active
created: 2026-07-22
confidence: confirmed-by-code
tags: [reference, encyclopedia, critical]
---

# 📖 Application Encyclopedia — المرجع الشامل

> **هذا هو المرجع الرسمي للتطبيق. يجب أن يبقى محدّثاً بعد كل تغيير مهم.**

## 🏗️ هيكل المشروع

```
pythagoras-deploy/
├── src/                        ← لوحة الأدمن (Next.js 16)
│   ├── app/
│   │   ├── admin/              ← صفحات الـ admin
│   │   ├── api/                ← API routes
│   │   ├── layout.tsx          ← الـ root layout
│   │   └── route.ts            ← يخدم تطبيق الطالب في /
│   ├── components/             ← React components
│   │   └── admin/              ← مكونات الـ admin
│   ├── lib/                    ← utilities
│   │   ├── db.ts               ← Prisma client
│   │   └── utils.ts            ← helper functions
│   └── hooks/                  ← React hooks
├── public/
│   └── pythagoras/             ← تطبيق الطالب (Vanilla JS)
│       ├── index.html
│       └── src/
│           ├── scripts/
│           ├── pages/
│           └── components/
├── prisma/
│   └── schema.prisma           ← Database schema
├── Pythagoras-Brain/           ← Second Brain (هذا الـ vault)
├── graphify-out/               ← Graphify graph (محلي، .gitignore)
├── .ua/                        ← Understand Anything graph (محلي)
└── scripts/                    ← سكريبتات مساعدة
```

---

## 📄 صفحات الـ Admin

### `/admin` — Dashboard
- **الهدف**: نظرة عامة على النظام
- **المكونات**: KPIs، نشاط، تحليلات بانرات، System Health
- **يعتمد على**: `/api/health`, `/api/events`
- **إذا كسرته**: المستخدم يفقد النظرة العامة

### `/admin/analytics` — Health Dashboard
- **الهدف**: فحوصات حية لصحة النظام
- **المكونات**: Health checks، performance metrics
- **يعتمد على**: `/api/health`
- **إذا كسرته**: لا توجد مراقبة للنظام

### `/admin/banners` — إدارة البانرات
- **الهدف**: CRUD للبانرات + scheduling + archive
- **المكونات**: `BannerEditor`, `AdminBannerCard`
- **يعتمد على**: localStorage (للحفظ المؤقت)
- **إذا كسرته**: الصفحة الرئيسية للطالب تُعرض بدون بانرات

### `/admin/users` — إدارة المستخدمين
- **الهدف**: عرض وإدارة الطلاب
- **المكونات**: جدول مستخدمين، فلاتر، بحث
- **يعتمد على**: `/api/users` (Prisma)
- **إذا كسرته**: لا إدارة للمستخدمين

### `/admin/premium` — إدارة Premium
- **الهدف**: عرض الاشتراكات النشطة
- **المكونات**: جدول اشتراكات
- **يعتمد على**: `/api/premium` (Prisma)
- **إذا كسرته**: لا تتبع للإيرادات

### `/admin/graphify` — Knowledge Graph
- **الهدف**: بوابة لـ graphs (Graphify + Understand Anything)
- **المكونات**: بطاقتان مع أزرار تفتح GitHub Pages
- **لا يعتمد على server** — كل الروابط خارجية
- **إذا كسرته**: لا وصول للـ graphs من الـ admin

### `/admin/materials` — إدارة المواد
- **الهدف**: CRUD للمواد الدراسية
- **المكونات**: `AdminPageLayout`, `MaterialEditor`
- **يعتمد على**: localStorage (حالياً)
- **إذا كسرته**: الطالب لا يرى المواد

### `/admin/navigation` — إدارة التنقل
- **الهدف**: ترتيب عناصر التنقل في تطبيق الطالب
- **المكونات**: `AdminPageLayout`, drag-and-drop list
- **إذا كسرته**: تنقل الطالب معطّل

### `/admin/tools` — إدارة الأدوات
- **الهدف**: CRUD للأدوات المساعدة
- **المكونات**: `AdminPageLayout`, editor
- **إذا كسرته**: أدوات الطالب معطّلة

---

## 📄 صفحات الطالب (Vanilla JS)

### `/` (تطبيق الطالب)
- **الهدف**: التطبيق الكامل للطالب
- **التقنية**: Vanilla JS SPA في `public/pythagoras/`
- **الصفحات الداخلية**:
  - الصفحة الرئيسية (بانرات + مواد)
  - صفحة المادة (أقسام + حزم)
  - صفحة الحزمة (أسئلة)
  - صفحة السؤال (حل + شرح)
  - الإعدادات
- **يعتمد على**: localStorage (حالياً)، سيُربط بـ API لاحقاً

---

## 🔌 API Routes

### `/api/health`
- **الطريقة**: GET
- **الهدف**: فحص صحة النظام (DB، analytics، premium، errors)
- **يعتمد على**: Prisma (User, AnalyticsEvent, PremiumSubscription)
- **يستخدمه**: `/admin`, `/admin/analytics`

### `/api/events`
- **الطريقة**: GET
- **الهدف**: جلب analytics events
- **المعاملات**: `range` (daily, weekly, monthly, yearly, all)
- **يعتمد على**: Prisma (AnalyticsEvent)
- **يستخدمه**: `/admin` (Dashboard)

### `/api/users`
- **الطريقة**: GET, POST
- **الهدف**: إدارة المستخدمين
- **يعتمد على**: Prisma (User)
- **يستخدمه**: `/admin/users`

### `/api/premium`
- **الطريقة**: GET
- **الهدف**: جلب الاشتراكات النشطة
- **يعتمد على**: Prisma (PremiumSubscription)
- **يستخدمه**: `/admin/premium`

### `/` (route handler)
- **الطريقة**: GET
- **الهدف**: يخدم `public/pythagoras/index.html` مع إعادة كتابة المسارات
- **لا يعتمد على** شيء (static file)

---

## 🧩 Components المهمة

### `AdminShell`
- **الموقع**: `src/components/admin/AdminShell.tsx`
- **الوظيفة**: الـ shell الرئيسي (sidebar + topbar + content area)
- **يحتوي على**: `AdminSidebar`, `AdminTopBar`, `CommandPalette`, `ActivityCenterDrawer`
- **يستخدمه**: كل صفحات `/admin/*`
- **إذا كسرته**: كل الـ admin ينهار

### `AdminSidebar`
- **الموقع**: `src/components/admin/AdminSidebar.tsx`
- **الوظيفة**: التنقل الجانبي
- **المجموعات**: نظرة عامة، المحتوى، التسويق، المستخدمون، النظام
- **إذا كسرته**: لا تنقل في الـ admin

### `AdminTopBar`
- **الموقع**: `src/components/admin/AdminTopBar.tsx`
- **الوظيفة**: الشريط العلوي (search, notifications, user menu)
- **إذا كسرته**: لا search ولا notifications

### `AdminPageLayout`
- **الموقع**: `src/components/admin/AdminPageLayout.tsx`
- **الوظيفة**: layout موحّد لصفحات الإدارة (materials, navigation, tools)
- **يحتوي على**: title, subtitle, list, editor, preview
- **إذا كسرته**: صفحات الإدارة تفقد هيكلها

### `BannerEditor`
- **الموقع**: `src/components/admin/BannerEditor.tsx`
- **الوظيفة**: محرر البانرات (صورة، نص، وجهة، جدولة)
- **إذا كسرته**: لا إنشاء/تعديل للبانرات

### `DashboardView`
- **الموقع**: `src/components/admin/DashboardView.tsx`
- **الوظيفة**: الـ dashboard الرئيسي (KPIs, activity, analytics)
- **إذا كسرته**: الـ admin homepage فارغة

### `IconPicker`
- **الموقع**: `src/components/admin/IconPicker.tsx`
- **الوظيفة**: اختيار أيقونة من 130 أيقونة في 12 تصنيف
- **يستخدمه**: `BannerEditor`, `MaterialEditor`

---

## 🗄️ Database Schema

### User
```
id          String   @id @default(cuid())
email       String   @unique
name        String?
role        String   @default("student")  // student, teacher, admin
grade       String?
displayName String?
isActive    Boolean  @default(true)
createdAt   DateTime @default(now())
updatedAt   DateTime @updatedAt
subscriptions PremiumSubscription[]
```

### PremiumSubscription
```
id            String   @id @default(cuid())
userId        String
plan          String   @default("monthly")  // monthly, yearly, lifetime
status        String   @default("active")   // active, cancelled, expired, pending
price         Int      @default(0)  // IQD (Iraqi Dinar)
startedAt     DateTime @default(now())
endsAt        DateTime?
paymentMethod String?
createdAt     DateTime @default(now())
updatedAt     DateTime @updatedAt
user          User     @relation(...)
```

### AnalyticsEvent
```
id          String   @id @default(cuid())
type        String   // page_view, question_answered, etc.
userId      String?
entityType  String?
entityId    String?
metadata    String?
timestamp   DateTime @default(now())
user        User?    @relation(...)
```

---

## 🔄 دورة عمل التطبيق

### للطالب
```
يفتح الموقع (/)
→ يرى الصفحة الرئيسية (بانرات + مواد)
→ يختار مادة
→ يرى الأقسام
→ يختار قسم
→ يرى الحزم
→ يختار حزمة
→ يحل الأسئلة
→ يرى الإجابات + الشرح
→ يتتبع تقدمه
```

### للأدمن
```
يفتح /admin
→ يرى Dashboard (إحصائيات)
→ يدير المحتوى:
  - المواد → الأقسام → المواضيع → الحزم → الأسئلة
→ يدير التسويق:
  - البانرات (جدولة، وجهات)
→ يدير المستخدمين:
  - عرض، تعديل، تفعيل/إيقاف
→ يدير Premium:
  - اشتراكات، مدفوعات
→ يراقب النظام:
  - Health, Analytics
```

---

## ⚠️ ما يجب الحذر من كسره

### حرج جداً (لا تلمسه بدون سبب قوي)
- `src/app/layout.tsx` — الـ root layout
- `src/lib/db.ts` — Prisma client
- `prisma/schema.prisma` — DB schema
- `db/custom.db` — ملف قاعدة البيانات
- `next.config.ts` — إعدادات Next.js

### حرج
- `AdminShell` — يكسر كل الـ admin
- `AdminSidebar` — يكسر التنقل
- API routes — تكسر الـ admin pages

### أقل حرجاً
- صفحات محددة (يمكن إصلاحها بسهولة)
- مكونات منفصلة

---

## 🔗 الروابط

- [[Project-DNA]] — مبادئ المشروع
- [[Design-Language-Bible]] — فلسفة التصميم
- [[Architecture-Decisions]] — قرارات معمارية
- [[00-Index]] — العودة للبوابة
