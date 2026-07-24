---
type: adr
adr-id: ADR-001
date: 2026-07-19
status: accepted
ai-model: GLM
tags: [adr, architecture, database, critical]
---

# ADR-001: استخدام Prisma + SQLite (وليس Supabase)

## السياق

نحتاج قاعدة بيانات للمشروع. الـ M1-M4 حاولت استخدام Supabase (PostgreSQL) لكن فشلت بسبب:
- مشاكل camelCase ↔ snake_case
- تعقيد إضافي
- `.env` يتم مسحه باستمرار
- الـ container لا يتعامل جيداً مع external DB

## القرار

استخدام **Prisma ORM + SQLite** كقاعدة بيانات.

## البدائل المدروسة

### 1. Supabase (PostgreSQL) — رُفض
**سبب الرفض:**
- مشاكل camelCase ↔ snake_case (تحويل معقد)
- `42710: policy already exists` errors
- `.env` يتم مسحه باستمرار
- الـ container لا يتعامل جيداً مع external DB
- فشل مرتين (M1-M4 كاملة)

### 2. Firebase (Firestore) — رُفض
**سبب الرفض:**
- يتطلب billing account حتى للنطاق المجاني
- vendor lock-in
- لا يدعم RTL بشكل جيد في الـ console

### 3. Prisma + PostgreSQL — مؤجل
**سبب التأجيل:**
- تعقيد إضافي (server منفصل)
- SQLite كافٍ للمرحلة الحالية
- يمكن الترحيل لاحقاً بنفس الـ ORM (Prisma)

## سبب اختيار الحل النهائي

1. **بسيط** — ملف واحد (`db/custom.db`)
2. **مجاني** — لا server منفصل
3. **يعمل في الـ container** — لا مشاكل external DB
4. **type-safe** — Prisma يولّد أنواع TypeScript
5. **migration سهل** — `prisma migrate`
6. **لا vendor lock-in** — SQLite معيار مفتوح

## تأثير القرار على المشروع

- **إيجابي:** استقرار، بساطة، سرعة تطوير
- **سلبي:** لا يدعم concurrent writes عالية (لكن كافٍ للمرحلة الحالية)
- **مستقبلي:** يمكن الترحيل لـ PostgreSQL بنفس Prisma schema

## الملفات المتأثرة

- `prisma/schema.prisma` — الـ schema الرئيسي
- `src/lib/db.ts` — Prisma client
- `db/custom.db` — ملف قاعدة البيانات

## القرارات المرتبطة

- [[ADR-002-Production-Build]] — Production build للمعاينة
- [[Why-Log#لماذا Prisma + SQLite (وليس Supabase)؟]]

## إمكانية مراجعة القرار

- **متى:** إذا احتجنا concurrent writes عالية (> 1000 مستخدم متزامن)
- **كيف:** تغيير `provider` في `schema.prisma` من `sqlite` إلى `postgresql`
- **التكلفة:** منخفضة (Prisma يدعم كلاهما)

## 🔗 الروابط

- [[Problem-Log#مشكلة 2: Supabase Migration Failure]]
- [[Anti-Repetition-Brain#❌ Supabase Migration]]
- [[Architecture-Decisions#Prisma + SQLite (ليس Supabase)]]
- [[00-Index]]
