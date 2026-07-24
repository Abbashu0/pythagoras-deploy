---
type: collaboration
date: 2026-07-22
ai-model: GLM
tags: [collaboration, iraq, obsidian, second-brain, critical]
---

# محادثة: العراق + Obsidian Second Brain

## السياق

المستخدم لاحظ أن المشروع يفترض أنه سوري، وأراد نظام ذاكرة طويلة المدى.

## ما طلب المستخدم

> "المشروع في العراق وليس سوريا، العملة دينار عراقي."

ثم:

> "أريد منك إضافة Obsidian كجزء أساسي من نظام إدارة المعرفة الخاص بمشروع Pythagoras Platform."

ثم (لاحقاً):

> "أريد منك اعتبار Obsidian Vault الخاص بمشروع Pythagoras Platform هو الذاكرة طويلة المدى (Second Brain) للمشروع."

## كيف فهمت الطلب

المستخدم يريد:
1. تصحيح الدولة (العراق) والعملة (IQD)
2. نظام معرفة شامل (Second Brain)
3. ذاكرة طويلة المدى للمشروع
4. أي AI جديد يفهم المشروع بسرعة
5. نظام مترابط، ليس مجرد ملفات منفصلة

## ما تم الاتفاق عليه

### للعراق:
- تغيير SYP → IQD في `prisma/schema.prisma`
- لا مراجع أخرى لسوريا

### لـ Obsidian:
- إنشاء vault في `Pythagoras-Brain/`
- هيكل: Project-Overview, Development-History, Decisions, Problems-and-Solutions, AI-Memory, Roadmap
- Git-synced (نفس repo)
- workflow: قراءة قبل، تحديث بعد

### لـ Second Brain (الترقية):
- Project Timeline
- AI Collaboration History
- Application Encyclopedia
- Project DNA
- Design Language Bible
- AI Personality Guide
- Feature Lifecycle
- Knowledge Confidence
- Anti-Repetition Brain
- Why Log
- AI Engineers
- Reviews (Self-Reflection, Prediction, Weekly)
- Impact Maps
- Project Glossary
- Smart Index

## ما الذي تغير في اتجاه المشروع

- **قبل:** المشروع بلا ذاكرة، كل جلسة تبدأ من الصفر
- **بعد:** المشروع له عقل (Second Brain) يحفظ كل شيء

## القرارات المهمة

### 1. Obsidian vault في نفس repo
**سبب القرار:** أبسط (لا repo منفصل)، كل شيء في مكان واحد
**النتيجة:** مزامنة عبر `git push/pull`

### 2. Git-based sync (ليس Obsidian Sync المدفوع)
**سبب القرار:** مجاني، يعمل مع Windows + iPhone
**النتيجة:** المزامنة عبر `git pull`

### 3. Smart Index كبوابة
**سبب القرار:** أي AI جديد يبدأ من مكان واحد
**النتيجة:** [[00-Index]] يجمع كل شيء

### 4. ADR منفصل لكل قرار معماري
**سبب القرار:** كل قرار له سياق كامل
**النتيجة:** `Decisions/ADR/` مع ملفات مستقلة

## لماذا نجح

1. **الاستماع للمستخدم** — العراق + Second Brain
2. **التنظيم** — كل ملف له دور واضح
3. **الروابط** — `[[wikilinks]]` تربط المعرفة
4. **مستويات الثقة** — لا نخلط الحقائق بالآراء

## الدرس الأهم

> **الـ Second Brain ليس أرشيفاً، بل ذاكرة حية.** يجب تحديثه بعد كل مهمة، ومراجعته قبل كل مهمة.

## 🔗 الروابط

- [[TL-004-GitHub-Pages-Cleanup]]
- [[UX-Decisions#العراق بدلاً من سوريا]]
- [[Project-DNA]]
- [[00-Index]]
