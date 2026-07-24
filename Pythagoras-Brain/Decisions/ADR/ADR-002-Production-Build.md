---
type: adr
adr-id: ADR-002
date: 2026-07-21
status: accepted
ai-model: GLM
tags: [adr, architecture, build, critical]
---

# ADR-002: Production Build للمعاينة (وليس Dev Mode)

## السياق

استخدمنا `npm run dev` للمعاينة عبر preview URL. المشاكل:
- بطيء (2-6 ثوانٍ لكل صفحة)
- compile عند الطلب يستهلك CPU
- الـ server يموت أسرع (الـ container يقتله)
- المستخدم يرى أخطاء compile

## القرار

استخدام **`npm run build` + `npm run start`** دائماً للمعاينة.

## البدائل المدروسة

### 1. `npm run dev` — رُفض
**سبب الرفض:**
- بطيء جداً (2-6 ثوانٍ لكل صفحة)
- compile عند الطلب
- الـ server يموت أسرع

### 2. Vite + React منفصل — رُفض
**سبب الرفض:**
- يحتاج server منفصل للـ API
- تعقيد إضافي

## سبب اختيار الحل النهائي

1. **استجابة فورية** (11ms بدلاً من 2-6s)
2. **استقرار أكبر** (لا compile عند الطلب)
3. **`output: "standalone"`** يُنتج server مستقل
4. **أقل استهلاك CPU** (لا watch mode)

## تأثير القرار على المشروع

- **إيجابي:** سرعة، استقرار، تجربة معاينة ممتازة
- **سلبي:** يجب `npm run build` بعد كل تغيير (لكن يستحق)
- **ملاحظة:** نستخدم dev mode فقط أثناء التطوير النشط (لم نعد نستخدمه)

## الملفات المتأثرة

- `next.config.ts` — `output: "standalone"`
- `.next/standalone/server.js` — الـ server الناتج
- `scripts/keep-alive.sh` — يشغل `npm run start`

## القرارات المرتبطة

- [[ADR-003-GitHub-Pages-For-Graphs]] — Graphs على GitHub Pages
- [[Why-Log#لماذا Production Build (وليس Dev Mode)؟]]

## إمكانية مراجعة القرار

- **متى:** إذا احتجنا hot reload سريع أثناء التطوير
- **كيف:** `npm run dev` لكن ليس للمعاينة
- **التكلفة:** لا شيء

## 🔗 الروابط

- [[Lessons-Learned#درس 1: Production Build أفضل من Dev Mode]]
- [[Architecture-Decisions#Production Build (ليس Dev Mode)]]
- [[00-Index]]
