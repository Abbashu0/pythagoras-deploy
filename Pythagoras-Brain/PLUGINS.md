---
type: guide
status: active
created: 2026-07-22
tags: [setup, plugins, guide]
---

# إعدادات Obsidian — Plugins الموصى بها

## 🎯 Plugins أساسية (ثبّتها أولاً)

### 1. Dataview (الأهم!)
**الوصف:** استعلامات على الملاحظات — مثل SQL للـ Markdown.
**مثلاً:** "أظهر كل المهام غير المكتملة من كل الملفات"

**التثبيت:**
1. `Settings` → `Community plugins` → `Turn on community plugins`
2. `Browse` → ابحث عن `Dataview`
3. `Install` → `Enable`

**الاستخدام:**
````markdown
```dataview
TASK FROM "Development-History"
WHERE !completed
```
````

---

### 2. Excalidraw (للرسومات)
**الوصف:** ارسم مخططات، architectures، flowcharts مباشرة في Obsidian.
**مثلاً:** ارسم architecture diagram لـ Pythagoras Platform

**التثبيت:** نفس الطريقة، ابحث عن `Excalidraw`

**الاستخدام:**
- أنشئ ملف `.excalidraw.md` جديد
- ارسم بالماوس
- اربطه بالملاحظات الأخرى بـ `[[wikilinks]]`

---

### 3. Kanban (للمهام)
**الوصف:** لوحات Kanban لإدارة المهام (To Do, In Progress, Done).

**التثبيت:** ابحث عن `Kanban`

**الاستخدام:**
- أنشئ ملف `Kanban` جديد
- أضف أعمدة: Backlog, To Do, In Progress, Done
- اسحب المهام بين الأعمدة

---

### 4. Templater (للقوالب)
**الوصف:** قوالب سريعة لإنشاء ملاحظات جديدة بنفس البنية.

**التثبيت:** ابحث عن `Templater`

**الاستخدام:**
- أنشئ مجلد `Templates/` في الـ vault
- أضف قوالب مثل `task-template.md`
- استخدم `Alt+E` لإنشاء ملاحظة من قالب

---

### 5. Calendar (للتواريخ)
**الوصف:** عرض تقويمي للملاحظات اليومية.

**التثبيت:** ابحث عن `Calendar`

**الاستخدام:**
- يظهر تقويم في الـ sidebar الأيمن
- اضغط على أي يوم لإنشاء daily note

---

### 6. Outliner (للـ lists)
**الوصف:** تحسين تجربة الـ bullet lists (مثل Workflowy).

**التثبيت:** ابحث عن `Outliner`

---

### 7. Editor Syntax Highlight
**الوصف:** تلوين الكود في code blocks.

**التثبيت:** ابحث عن `Editor Syntax Highlight`

---

## 🎨 Plugins لتحسين الـ Graph View

### 8. Extended Graph (مهم!)
**الوصف:** يحسّن الـ graph view الافتراضي — صور، shapes، ألوان أفضل.

**التثبيت:** ابحث عن `Extended Graph`

**الفائدة:** الـ graph الذي رأيته سيصبح أجمل وأكثر وضوحاً.

---

### 9. Juggl (متقدم)
**الوصف:** graph view تفاعلي متقدم مع filtering و navigation.
**ملاحظة:** ثقيل قليلاً، استخدمه فقط إذا احتجت features متقدمة.

---

## 📊 Plugins للتحليل

### 10. Dataview (ذكرناه فوق — الأهم)

### 11. Tasks
**الوصف:** إدارة مهام متقدمة مع تواريخ استحقاق.

**التثبيت:** ابحث عن `Tasks`

---

## 🔧 Plugins إضافية (اختيارية)

### 12. Advanced Tables
**الوصف:** إنشاء وتحرير جداول Markdown بسهولة.

### 13. Mind Map
**الوصف:** تحويل الملاحظات لـ mind maps.

### 14. Diagrams
**الوصف:** رسم diagrams (mermaid, flowcharts).

### 15. Admonitions
**الوصف:** صناديق ملونة للتنبيهات (warning, info, tip).

---

## ⚙️ خطوات التثبيت (مرة واحدة)

1. افتح Obsidian
2. `Settings` (أيقونة الترس في الأسفل)
3. `Community plugins` في الـ sidebar
4. اضغط **"Turn on community plugins"**
5. اضغط **"Browse"**
6. ابحث عن كل plugin من القائمة فوق
7. `Install` → `Enable`

## 🎯 الترتيب الموصى به للتثبيت

1. **Dataview** — الأساسي
2. **Excalidraw** — للرسومات
3. **Kanban** — للمهام
4. **Templater** — للقوالب
5. **Calendar** — للتواريخ
6. **Extended Graph** — لتحسين الـ graph
7. الباقي حسب الحاجة

---

## 🔌 إعدادات بعد التثبيت

### Dataview
- `Settings` → `Dataview`
- فعّل `Enable JavaScript Queries` (للاستعلامات المتقدمة)
- فعّل `Enable Inline Queries`

### Templater
- `Settings` → `Templater`
- `Template folder location`: `Templates`
- فعّل `Trigger Templater on new file creation`

### Kanban
- `Settings` → `Kanban`
- اختر `Date format` مناسب

---

## 📝 قوالب جاهزة (Templates)

سأنشئ مجلد `Templates/` في الـ vault مع قوالب جاهزة:
- `task-template.md` — لمهام جديدة
- `problem-template.md` — لمشاكل جديدة
- `decision-template.md` — لقرارات جديدة
- `lesson-template.md` — لدروس جديدة

---

## الروابط

- [[SETUP]]
- [[Workflow]]
- [[README]]
