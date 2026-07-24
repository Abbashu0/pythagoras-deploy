---
type: glossary
status: active
created: 2026-07-22
confidence: confirmed-by-code
tags: [glossary, reference]
---

# 📖 Project Glossary — قاموس المشروع

> **كل مصطلح خاص بالمشروع مشروح هنا.**

## A

### Admin
لوحة الإدارة — Next.js app في `src/app/admin/`. تدير المحتوى والمستخدمين والنظام.

### AdminShell
الـ shell الرئيسي للوحة الإدمن. يحتوي على sidebar + topbar + content area.

### ADR
Architecture Decision Record — ملف مستقل لكل قرار معماري. في `Decisions/ADR/`.

### AnalyticsEvent
حدث تحليلي يُسجّل في DB (page_view, question_answered, إلخ).

### Anti-Repetition-Brain
قسم في الـ vault يسجل الأفكار المرفوضة لمنع إعادة اقتراحها. [[Anti-Repetition-Brain]]

## B

### Banner
بانر إعلاني يظهر في الصفحة الرئيسية للطالب. يدعم scheduling و destinations.

### Brain (Second Brain)
الـ Obsidian vault في `Pythagoras-Brain/`. ذاكرة المشروع طويلة المدى.

## C

### Container
البيئة التي يعمل فيها المشروع. يقتل العمليات الخلفية بعد 45-60 ثانية. [[Problem-Log#مشكلة 1]]

### Content Studio
قسم في الـ admin لإدارة المحتوى (مواد، أقسام، حزم، أسئلة). كان في M1-M4، تم التراجع عنه.

## D

### DNA (Project DNA)
ملف يصف شخصية المشروع ومبادئه. [[Project-DNA]]

### Dashboard
الصفحة الرئيسية للوحة الإدمن. تعرض KPIs ونشاط وحالة النظام.

## F

### Feature Lifecycle
دورة حياة الميزة: Idea → Research → Approved → Design → Implementation → Testing → Released → Improved → Deprecated. [[Feature-Lifecycle]]

## G

### GitHub Pages
خدمة استضافة static files من GitHub. نستخدمها للـ graphs على `abbashu0.github.io/pythagoras-deploy/`.

### Graphify
أداة تحليل بنيوي للكود بـ tree-sitter AST. الـ graph محلي في `graphify-out/`. [[Technology-Decisions#Graphify]]

## I

### IQD
Iraqi Dinar — الدينار العراقي. عملة المشروع الرسمية.

### Impact Map
خريطة تأثير تغيير ما. في `Impact-Maps/`. [[Impact-Maps]]

## K

### Knowledge Confidence
مستوى ثقة المعرفة في الـ vault. [[Knowledge-Confidence]]

## P

### Package
حزمة أسئلة. تحتوي على أسئلة وموارد. تنتمي لمادة/قسم/موضوع.

### Prisma
ORM نستخدمه مع SQLite. في `prisma/schema.prisma`.

### Premium
اشتراك مدفوع (شهري/سنوي/مدى الحياة). بـ IQD.

### Production Build
`npm run build` + `npm run start`. أسرع وأكثر استقراراً من dev mode.

### Pythagoras
اسم المشروع. منصة تعليمية لطلاب السادس الإعدادي في العراق.

## R

### RTL
Right-to-Left. اتجاه النص العربي. `dir="rtl"` إلزامي في كل الواجهة.

## S

### Second Brain
نفس الـ Brain. راجع Brain.

### SQLite
قاعدة البيانات. ملف واحد في `db/custom.db`. بسيط ومجاني.

### Standalone
وضع `output: "standalone"` في Next.js. يُنتج `.next/standalone/server.js` قابل للنشر مستقلاً.

## T

### Timeline
سجل زمني لكل الأحداث المهمة. في `Timeline/`. [[Timeline]]

### Turbopack
مُحرك build في Next.js 16. أسرع من Webpack.

## U

### Understand Anything
أداة تحليل دلالي للكود. الـ graph محلي في `.ua/`. [[Technology-Decisions#Understand Anything]]

### UX Decisions
قرارات تجربة المستخدم. في `Decisions/UX-Decisions.md`.

## V

### Vault
مجلد Obsidian. في حالتنا `Pythagoras-Brain/`.

## W

### Why Log
سجل يشرح لماذا اتخذنا كل قرار. [[Why-Log]]

### Workflow
دورة العمل المتكاملة. [[Workflow]]

---

## 🔗 الروابط

- [[00-Index]] — العودة للبوابة
- [[Application-Encyclopedia]] — مرجع التطبيق
- [[Project-DNA]] — شخصية المشروع
