---
type: timeline
event-id: TL-002
date: 2026-07-19
ai-model: GLM
status: failed
tags: [timeline, supabase, failure, m1-m4]
---

# TL-002: فشل Supabase Migration (M1-M4)

## 📋 المهمة

**العنوان:** ترحيل المشروع من localStorage إلى Supabase (PostgreSQL)

**الطلب الأصلي للمستخدم:**
> "نريد تخزين حقيقي للبيانات بدلاً من localStorage"

**فهمي للمطلوب:**
إعادة بناء الـ backend لـ Supabase مع entities + registries + repositories + validation + content studio + package workspace.

## 🔨 التنفيذ

**الخطة:**
1. إنشاء entities (Subject, Section, Topic, Package, Question, Resource, Source, Tag, RegistryEntry, HistoryEntry)
2. إنشاء 9 registries (subjects, question-types, sources, difficulty, resource-types, branches, exam-sessions, languages, package-status)
3. إنشاء BaseRepository مع تحويل camelCase↔snake_case
4. إنشاء API routes (packages, questions, registries, subjects, supabase-test)
5. إنشاء Content Studio UI
6. إنشاء Package Workspace (3-column layout)

**الملفات المتأثرة:**
- `src/lib/entities/` (10 entities)
- `src/lib/registries/` (9 registries)
- `src/lib/repositories/` (BaseRepository + 10 repositories)
- `src/lib/supabase/` (supabase-server, supabase-client)
- `src/app/api/` (packages, questions, registries, subjects, supabase-test)
- `src/app/admin/content/` (Content Studio)
- `src/components/admin/` (PackageCard, QuestionList, QuestionEditor, QuestionInspector)
- `src/lib/supabase/schema.sql` (10 tables + RLS + triggers)

**ما تم تنفيذه:**
- كل الكود المذكور فوق
- schema.sql مع idempotent policies
- seed.sql مع 56 registry entries + 12 subjects + 10 tags
- BaseRepository مع تحويل تلقائي
- Content Studio مع PackageCard
- Package Workspace مع 3-column layout

## 📊 النتيجة

**النتيجة النهائية:** فشل كامل

**سبب الفشل:**
1. مشاكل camelCase ↔ snake_case (تحويل معقد)
2. `42710: policy already exists` errors
3. `.env` يتم مسحه باستمرار
4. الـ container لا يتعامل جيداً مع external DB
5. تعقيد إضافي بدون فائدة حقيقية

**التأثير على المشروع:**
- إهدار وقت كبير
- تراجع كامل لـ commit `406b662` (قبل M1)
- فقدان كل عمل M1-M4

## 📝 الدروس

1. **لا تغير الـ DB بدون سبب قوي** — [[Mistakes-To-Avoid#خطأ 3]]
2. **Prisma + SQLite كافي** للمشروع الحالي
3. **camelCase ↔ snake_case** تعقيد غير ضروري
4. **الـ container** لا يناسب external DB

## 🔮 ملاحظات مستقبلية

- لا نعيد محاولة Supabase — [[Anti-Repetition-Brain#❌ Supabase Migration]]
- إذا احتجنا PostgreSQL، استخدم Prisma معه (نفس الـ ORM)

## 🔗 الروابط

- [[Problem-Log#مشكلة 2: Supabase Migration Failure]]
- [[Anti-Repetition-Brain#❌ Supabase Migration]]
- [[Why-Log#لماذا Prisma + SQLite (وليس Supabase)؟]]
- [[00-Index]]
