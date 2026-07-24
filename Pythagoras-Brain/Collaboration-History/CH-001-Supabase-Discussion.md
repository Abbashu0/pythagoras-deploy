---
type: collaboration
date: 2026-07-19
ai-model: GLM
tags: [collaboration, supabase, failure, critical]
---

# محادثة: فشل Supabase Migration

## السياق

المستخدم أراد تخزين حقيقي للبيانات بدلاً من localStorage.

## ما طلب المستخدم

> "نريد تخزين حقيقي للبيانات. Firebase يطلب billing. جرب Supabase."

## كيف فهمت الطلب

المستخدم يريد:
1. التخلص من localStorage
2. قاعدة بيانات حقيقية
3. مجانية (لا billing)
4. دعم RTL والعربية

## ما تم الاتفاق عليه

- استخدام Supabase (PostgreSQL)
- إنشاء entities + registries + repositories
- بناء Content Studio + Package Workspace
- ترحيل كل البيانات

## ما الذي تغير في اتجاه المشروع

- **قبل:** المشروع يستخدم localStorage فقط
- **أثناء:** محاولة Supabase مع schema معقد
- **بعد:** فشل كامل، تراجع لـ Prisma+SQLite

## القرارات المهمة

### 1. استخدام BaseRepository مع تحويل camelCase↔snake_case
**سبب القرار:** الـ entities تستخدم camelCase، SQL يستخدم snake_case
**النتيجة:** تعقيد إضافي، أخطاء كثيرة

### 2. إنشاء 9 registries منفصلة
**سبب القرار:** تجنب hardcoding القيم
**النتيجة:** مبالغة في التعقيد للمشروع الحالي

### 3. schema.sql idempotent
**سبب القرار:** تجنب `42710: policy already exists` errors
**النتيجة:** نجح تقنياً، لكن المشكلة الأكبر كانت camelCase

## لماذا فشل

1. **camelCase ↔ snake_case** — تحويل معقد لكل query
2. **`.env` يتم مسحه** — `supabaseUrl is required` باستمرار
3. **الـ container** — لا يتعامل جيداً مع external DB
4. **تعقيد unnecessary** — Prisma+SQLite أبسط وأكفي

## الدرس الأهم

> **لا تغير الـ DB بدون سبب قوي.** Prisma+SQLite كافٍ للمشروع الحالي.

## 🔗 الروابط

- [[TL-002-Supabase-Failure]]
- [[Problem-Log#مشكلة 2: Supabase Migration Failure]]
- [[Anti-Repetition-Brain#❌ Supabase Migration]]
- [[ADR-001-Prisma-SQLite]]
- [[00-Index]]
