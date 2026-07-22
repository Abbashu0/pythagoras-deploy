---
type: decision
category: architecture
status: active
created: 2026-07-22
tags: [decisions, architecture]
---

# قرارات معمارية

## Tech Stack الحالي

### Next.js 16 + Turbopack
**القرار:** استخدام Next.js 16 مع Turbopack للـ admin panel
**السبب:**
- سريع في الـ build
- React Server Components
- API routes مدمجة
- خيار `output: "standalone"` للنشر السهل

**البديل الذي رفضناه:** Vite + React منفصل
**السبب للرفض:** يحتاج server منفصل للـ API

---

### Prisma + SQLite (ليس Supabase)
**القرار:** العودة لـ Prisma + SQLite بعد فشل Supabase migration
**السبب:**
- بسيط (ملف واحد `db/custom.db`)
- لا يحتاج server منفصل
- مجاني تماماً
- يعمل في الـ container بدون مشاكل

**البديل الذي رفضناه:** Supabase (PostgreSQL)
**السبب للرفض:** [[Supabase Migration Failure]]
- مشاكل camelCase ↔ snake_case
- تعقيد إضافي بدون فائدة
- الـ container لا يتعامل جيداً مع external DB

---

### Vanilla JS لتطبيق الطالب
**القرار:** تطبيق الطالب في `public/pythagoras/` كـ Vanilla JS SPA
**السبب:**
- خفيف جداً (لا build step)
- سريع التحميل
- يعمل على أجهزة الطلاب الضعيفة
- لا يحتاج JavaScript framework

**البديل الذي رفضناه:** Next.js للطالب أيضاً
**السبب للرفض:** ثقيل، يحتاج server، غير ضروري لطالب يحتاج فقط قراءة المحتوى

---

### Production Build (ليس Dev Mode)
**القرار:** استخدام `npm run build` + `npm run start` بدلاً من `npm run dev`
**السبب:**
- استجابة فورية (11ms بدلاً من 2-6 ثوانٍ)
- استقرار أكبر
- لا compile عند الطلب

**متى نستخدم dev mode:** فقط أثناء التطوير النشط (لم نعد نستخدمه)

---

## Graphs على GitHub Pages

### القرار
الـ graphs (Graphify + Understand Anything) مستضافة على `abbashu0.github.io/pythagoras-deploy/` وليس على الـ container.

### السبب
[[Container Process Killing]] — الـ graphs الثقيلة (6MB+) كانت تقتل الـ container.

### التنفيذ
- `gh-pages` branch منفصل
- push تحديثات الـ graphs لهذا الـ branch
- GitHub Pages يخدمها تلقائياً

### الروابط
- [[Technology-Decisions#Graphify]]
- [[Technology-Decisions#Understand Anything]]

---

## Obsidian Vault في نفس Repo

### القرار
الـ vault في `Pythagoras-Brain/` داخل نفس repo المشروع.

### السبب
- أبسط (لا repo منفصل)
- كل شيء في مكان واحد
- المزامنة عبر نفس `git push` / `git pull`

### التنفيذ
- الـ vault في `.gitignore`؟ **لا** — نريده متزامناً
- الـ graphs المحلية (`graphify-out/`, `.ua/`) **في** `.gitignore` — كبيرة وغير ضرورية للـ repo

---

## الروابط

- [[UX-Decisions]]
- [[Technology-Decisions]]
- [[Product-Strategy]]
