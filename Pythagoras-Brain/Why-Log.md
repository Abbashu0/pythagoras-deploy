---
type: why-log
status: active
created: 2026-07-22
confidence: confirmed-by-user
tags: [decisions, reasoning, critical]
---

# ❓ Why Log — لماذا اتخذنا كل قرار

> **لا نسجل فقط ماذا حدث، بل لماذا حدث، ولماذا لم نختر الحلول الأخرى.**

## 📋 القرارات

### لماذا Prisma + SQLite (وليس Supabase)؟

**المشكلة:** نحتاج قاعدة بيانات للمشروع.

**البدائل المدروسة:**
1. Supabase (PostgreSQL) — رُفض
2. Firebase (Firestore) — رُفض
3. Prisma + SQLite — ✅ تم الاختيار

**لماذا رُفض Supabase:**
- مشاكل camelCase ↔ snake_case
- تعقيد إضافي
- فشل مرتين (M1-M4)
- راجع: [[Problem-Log#مشكلة 2: Supabase Migration Failure]]

**لماذا رُفض Firebase:**
- يتطلب billing account
- vendor lock-in

**لماذا Prisma + SQLite:**
- بسيط (ملف واحد)
- مجاني تماماً
- يعمل في الـ container
- type-safe
- migration سهل

**القرار النهائي:** Prisma + SQLite
**الـ ADR:** [[ADR-001-Prisma-SQLite]]

---

### لماذا Production Build (وليس Dev Mode)؟

**المشكلة:** التطبيق بطيء وينطفئ في dev mode.

**البدائل:**
1. `npm run dev` — رُفض
2. `npm run build` + `npm run start` — ✅ تم الاختيار

**لماذا رُفض dev mode:**
- بطيء (2-6 ثوانٍ لكل صفحة)
- compile عند الطلب
- الـ server يموت أسرع

**لماذا production build:**
- استجابة فورية (11ms)
- استقرار أكبر
- لا compile عند الطلب

**القرار النهائي:** Production build دائماً للمعاينة

---

### لماذا GitHub Pages للـ Graphs؟

**المشكلة:** الـ graphs تقتل الـ container.

**البدائل:**
1. خدمة من Next.js — رُفض
2. viewer server منفصل (port 5174) — رُفض
3. GitHub Pages — ✅ تم الاختيار

**لماذا رُفض Next.js serving:**
- الـ graphs ثقيلة (6MB+)
- memory spike يقتل الـ container

**لماذا رُفض viewer server:**
- الـ server يموت مع الـ container
- تعقيد إضافي

**لماذا GitHub Pages:**
- مجاني
- CDN سريع
- مستقل عن الـ container
- متاح دائماً

**القرار النهائي:** GitHub Pages لكل الـ graphs

---

### لماذا Vanilla JS لتطبيق الطالب؟

**المشكلة:** نحتاج تطبيق سريع للطالب.

**البدائل:**
1. Next.js للطالب أيضاً — رُفض
2. React SPA منفصل — رُفض
3. Vanilla JS — ✅ تم الاختيار

**لماذا رُفض Next.js للطالب:**
- ثقيل (يحتاج server)
- الـ student يحتاج فقط قراءة المحتوى
- مبالغة في التقنية

**لماذا Vanilla JS:**
- خفيف جداً (لا build step)
- سريع التحميل
- يعمل على أجهزة ضعيفة
- بسيط للصيانة

**القرار النهائي:** Vanilla JS في `public/pythagoras/`

---

### لماذا Obsidian للـ Second Brain؟

**المشكلة:** نحتاج ذاكرة طويلة المدى للمشروع.

**البدائل:**
1. Notion — رُفض
2. Confluence — رُفض
3. ملفات Markdown عادية — رُفض
4. Obsidian — ✅ تم الاختيار

**لماذا رُفض Notion:**
- cloud-based (لا يعمل offline)
- ليس ملفات حقيقية
- vendor lock-in

**لماذا رُفض Confluence:**
- مدفوع
- ثقيل
- مبالغة للمشروع

**لماذا رُفض Markdown عادي:**
- لا روابط بين الملفات
- لا graph view
- لا plugins

**لماذا Obsidian:**
- ملفات Markdown (لا lock-in)
- روابط `[[wikilinks]]`
- graph view
- مجاني
- plugins قوية

**القرار النهائي:** Obsidian vault في `Pythagoras-Brain/`

---

### لماذا العراق (وليس سوريا)؟

**المشكلة:** المشروع كان يفترض أنه سوري.

**السبب:** المستخدم أوضح أن المشروع للعراق.

**التغيير:**
- `SYP (Syrian Pounds)` → `IQD (Iraqi Dinar)` في `prisma/schema.prisma`
- لا مراجع أخرى لسوريا في الكود

**القرار النهائي:** العراق هو السوق المستهدف، IQD هو العملة

---

### لماذا حذف LivePreviewPanel؟

**المشكلة:** كسرت صفحات navigation/tools.

**القرار:** حذفها بالكامل (commit `d55f880`)

**البديل:** معاينة عادية (غير حية) كافية

---

### لماذا فلترة الـ graph لـ 530 nodes؟

**المشكلة:** الـ graph كامل (10,115 nodes) يقتل المتصفح.

**البدائل:**
1. عرض الكل — رُفض (OOM crash)
2. فلترة — ✅ تم الاختيار

**كيف الفلترة:**
- كل الـ files (256) — محتفظ بها
- كل الـ classes (65) — محتفظ بها
- أعلى 200 function — محتفظ بها
- بقية الـ functions — محذوفة

**النتيجة:** 530 nodes، 316 KB (بدلاً من 6.3 MB)

---

## 📝 كيفية الإضافة

عند اتخاذ قرار جديد:

```markdown
### لماذا [القرار]؟

**المشكلة:** [ما كانت المشكلة]
**البدائل:** [ما درسنا]
**لماذا رُفض [بديل]:** [سبب]
**لماذا اخترنا [الحل]:** [سبب]
**القرار النهائي:** [ما قررناه]
**الـ ADR:** [[رابط]] (إن وجد)
```

---

## 🔗 الروابط

- [[Decisions/ADR/|ADR Directory]] — Architecture Decision Records
- [[Anti-Repetition-Brain]] — ما رفضناه
- [[Problem-Log]] — المشاكل والحلول
- [[00-Index]] — العودة للبوابة
