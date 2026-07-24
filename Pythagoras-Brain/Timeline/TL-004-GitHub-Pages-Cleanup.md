---
type: timeline
event-id: TL-004
date: 2026-07-22
ai-model: GLM
status: completed
tags: [timeline, github-pages, cleanup, iraq]
---

# TL-004: تنظيف + GitHub Pages + العراق

## 📋 المهمة

**العنوان:** نقل الـ graphs لـ GitHub Pages + تنظيف الـ container + تغيير العراق

**الطلب الأصلي للمستخدم:**
> "اجعل ازرار فتح عرض الاثنين graphs في صفحة الادمن تاخذني مباشرة الى github pages links"
> "المشروع في العراق وليس سوريا، العملة دينار عراقي"

**فهمي للمطلوب:**
1. نقل كل الـ graphs لـ GitHub Pages (لا في الـ container)
2. تنظيف الـ server من ملفات الـ graphs
3. تحديث أزرار الـ admin لتفتح GitHub Pages
4. تغيير سوريا/SYP → العراق/IQD

## 🔨 التنفيذ

**الخطة:**
1. حذف `public/graphs/`, `public/understand-dashboard/`, `public/download/`
2. حذف `src/app/api/graphify/`, `src/app/api/understand/`
3. حذف `src/app/admin/graphify/viewer/`
4. تحديث `next.config.ts` (إزالة rewrites)
5. تحديث `/admin/graphify` (أزرار → GitHub Pages)
6. تغيير `prisma/schema.prisma` (SYP → IQD)

**الملفات المتأثرة:**
- `public/graphs/` (محذوف)
- `public/understand-dashboard/` (محذوف)
- `public/download/` (محذوف)
- `src/app/api/graphify/` (محذوف)
- `src/app/api/understand/` (محذوف)
- `src/app/admin/graphify/viewer/` (محذوف)
- `src/app/admin/graphify/page.tsx` (محدّث — أزرار GitHub Pages)
- `next.config.ts` (محدّث — إزالة rewrites)
- `prisma/schema.prisma` (محدّث — IQD)
- `scripts/keep-understand-alive.sh` (محذوف)
- `scripts/start-all.sh` (محذوف)

**ما تم تنفيذه:**
- كل الملفات المحذوفة
- صفحة `/admin/graphify` مبسّطة (بطاقتان + أزرار)
- GitHub Pages على `abbashu0.github.io/pythagoras-deploy/`
- `gh-pages` branch مع graphs
- تغيير SYP → IQD

## 📊 النتيجة

**النتيجة النهائية:** نجح

**التأثير على المشروع:**
- الـ server خفيف (لا graphs)
- الـ graphs على GitHub Pages (سريع، مستقر)
- المشروع للعراق (IQD)

## 📝 الدروس

1. **افصل الـ heavy assets عن الـ server** — [[Patterns-To-Follow#نمط 3]]
2. **GitHub Pages** للـ static HTML
3. **استمع للمستخدم** — العراق ليس سوريا

## 🔗 الروابط

- [[UX-Decisions#العراق بدلاً من سوريا]]
- [[Architecture-Decisions#Graphs على GitHub Pages]]
- [[Important-Changes]]
- [[00-Index]]
