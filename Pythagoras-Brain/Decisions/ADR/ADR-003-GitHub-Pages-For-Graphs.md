---
type: adr
adr-id: ADR-003
date: 2026-07-22
status: accepted
ai-model: GLM
tags: [adr, architecture, graphs, github-pages, critical]
---

# ADR-003: GitHub Pages للـ Graphs (وليس الـ Container)

## السياق

الـ graphs (Graphify + Understand Anything) كانت تُخدم من الـ Next.js server. المشاكل:
- الـ graphs ثقيلة (1.7MB - 6.3MB)
- memory spike يقتل الـ container
- الـ server ينطفئ باستمرار
- المتصفح يتعطل (10,115 nodes)

## القرار

استضافة الـ graphs على **GitHub Pages** (`abbashu0.github.io/pythagoras-deploy/`).

## البدائل المدروسة

### 1. خدمة من Next.js — رُفض
**سبب الرفض:**
- الـ graphs تقتل الـ container
- memory spike
- الـ server ينطفئ

### 2. Viewer server منفصل (port 5174) — رُفض
**سبب الرفض:**
- الـ server يموت مع الـ container
- تعقيد إضافي (port إضافي، proxy)
- صعوبة الوصول عبر preview URL

### 3. Cloudflare Pages / Vercel — مؤجل
**سبب التأجيل:**
- GitHub Pages كافٍ ومجاني
- الـ repo موجود على GitHub أصلاً

## سبب اختيار الحل النهائي

1. **مجاني** — 100GB bandwidth/شهر
2. **CDN سريع** — عالمي
3. **مستقل عن الـ container** — لا يتأثر بانطفائه
4. **متاح دائماً** — 24/7
5. **سهل التحديث** — `git push` لـ `gh-pages` branch

## تأثير القرار على المشروع

- **إيجابي:** استقرار الـ container، سرعة، موثوقية
- **سلبي:** يجب `git push` لتحديث الـ graphs (لكن يستحق)
- **ملاحظة:** الـ graphs المحلية (`graphify-out/`, `.ua/`) تبقى للاستخدام الداخلي

## الملفات المتأثرة

- `gh-pages` branch — الـ graphs المنشورة
- `src/app/admin/graphify/page.tsx` — أزرار تفتح GitHub Pages
- `graphify-out/` — graph محلي (.gitignore)
- `.ua/` — graph محلي (.gitignore)

## القرارات المرتبطة

- [[ADR-002-Production-Build]] — Production build
- [[Why-Log#لماذا GitHub Pages للـ Graphs؟]]

## إمكانية مراجعة القرار

- **متى:** إذا انتقلنا لـ VPS قوي
- **كيف:** خدمة الـ graphs من الـ VPS مباشرة
- **التكلفة:** متوسطة (إعادة بناء الـ admin page)

## 🔗 الروابط

- [[Problem-Log#مشكلة 1: Container Process Killing]]
- [[Problem-Log#مشكلة 3: Understand Anything Browser Crash]]
- [[Anti-Repetition-Brain#❌ Graphs في الـ Container]]
- [[00-Index]]
