---
type: changes
status: active
created: 2026-07-22
tags: [history, changes]
---

# تغييرات مهمة

## 2026-07-22

### تغيير سوريا → العراق
- **الملف:** `prisma/schema.prisma`
- **التغيير:** `SYP (Syrian Pounds)` → `IQD (Iraqi Dinar)`
- **السبب:** المشروع للعراق، ليس سوريا
- **القرار:** [[UX-Decisions#العراق بدلاً من سوريا]]

### تنظيف الـ server من الـ graphs
- **المحذوف:** `public/graphs/`, `public/understand-dashboard/`, `public/download/`
- **المحذوف:** `src/app/api/graphify/`, `src/app/api/understand/`
- **المحذوف:** `src/app/admin/graphify/viewer/`
- **السبب:** الـ graphs كانت تقتل الـ container
- **البديل:** GitHub Pages — [[Container Process Killing]]

### إنشاء Obsidian Second Brain
- **المجلد:** `Pythagoras-Brain/`
- **الهدف:** ذاكرة طويلة المدى للمشروع

## 2026-07-21

### تثبيت Graphify
- **الأداة:** `graphifyy` (Python package via uv)
- **الـ graph:** `graphify-out/graph.json` (1426 nodes)
- **الـ hook:** post-commit يُحدّث الـ graph تلقائياً

### تثبيت Understand Anything
- **الـ plugin:** في `~/.understand-anything/repo/`
- **الـ graph:** `.ua/knowledge-graph.json` (530 nodes مفلتر)
- **النشر:** على GitHub Pages (gh-pages branch)

## 2026-07-19

### التراجع عن M1-M4 + Supabase
- **الـ commit:** `406b662` (آخر commit قبل M1)
- **السبب:** [[Supabase Migration Failure]]
- **النتيجة:** العودة لـ Prisma + SQLite

## قبل 2026-07-19

### إلغاء LivePreviewPanel
- **السبب:** كسر صفحات navigation/tools
- **الـ commit:** `d55f880 revert: remove LivePreviewPanel`

### M1-M8 الأصلية
- تم بناؤها ثم التراجع عنها
- **التفاصيل:** [[Milestones]]

## الروابط

- [[Tasks]]
- [[Milestones]]
- [[Decisions]]
