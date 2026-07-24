---
type: collaboration
date: 2026-07-21
ai-model: GLM
tags: [collaboration, graphify, understand-anything, critical]
---

# محادثة: إضافة Graphify + Understand Anything

## السياق

المستخدم أراد أدوات لفهم الكود بسرعة وكفاءة.

## ما طلب المستخدم

> "اعتبر Graphify جزءًا أساسيًا من البنية التحتية لهذا المشروع وليس أداة اختيارية."

ثم لاحقاً:

> "أريد منك اعتبار Understand Anything أيضاً جزءًا أساسياً."

## كيف فهمت الطلب

المستخدم يريد:
1. أدوات تساعدني (AI) على فهم الكود بسرعة
2. visualization يمكن للمستخدم رؤيته
3. تحديث تلقائي بعد كل تغيير
4. تكامل مع الـ workflow

## ما تم الاتفاق عليه

- تثبيت Graphify (Python، tree-sitter AST)
- تثبيت Understand Anything (Node، semantic)
- صفحة admin للعرض
- git hooks للتحديث التلقائي
- visualization تفاعلي بـ D3.js

## ما الذي تغير في اتجاه المشروع

- **قبل:** فهم الكود بقراءة الملفات يدوياً
- **بعد:** فهم الكود بـ Graphify (سريع) + Understand Anything (عميق)

## القرارات المهمة

### 1. Graphify للبحث السريع
**سبب القرار:** سريع (tree-sitter، بدون LLM)، مجاني
**النتيجة:** ممتاز لـ `graphify query/explain/path`

### 2. Understand Anything للفهم العميق
**سبب القرار:** شروحات، tour mode، filter pills
**النتيجة:** ممتاز للفهم الدلالي

### 3. فلترة الـ graph لـ 530 nodes
**سبب القرار:** الـ graph كامل (10115) يقتل المتصفح
**النتيجة:** 530 nodes تعمل بسلاسة

### 4. نقل الـ graphs لـ GitHub Pages
**سبب القرار:** الـ container يُقتل من الـ graphs
**النتيجة:** استقرار كامل

## لماذا نجح (في النهاية)

1. **الاستماع للمستخدم** — نقل الـ graphs لـ GitHub Pages
2. **التكامل** — Graphify (سريع) + Understand (عميق)
3. **التحديث التلقائي** — git hooks
4. **الفصل** — graphs على GitHub Pages، server خفيف

## الدرس الأهم

> **افصل الـ heavy assets عن الـ server.** GitHub Pages للـ graphs، الـ container للـ app فقط.

## 🔗 الروابط

- [[TL-003-Graphify-Understand]]
- [[ADR-003-GitHub-Pages-For-Graphs]]
- [[Technology-Decisions#Graphify]]
- [[Technology-Decisions#Understand Anything]]
- [[00-Index]]
