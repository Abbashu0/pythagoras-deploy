---
type: knowledge-confidence
status: active
created: 2026-07-22
confidence: confirmed-by-user
tags: [meta, quality, critical]
---

# 🎯 Knowledge Confidence — مستويات الثقة

> **لا تخلط الحقائق مع الآراء.**
> **كل معلومة في الـ vault يجب أن تعرف مستوى ثقتها.**

## 📊 المستويات

| المستوى | الرمز | الوصف | مثال |
|---------|------|------|------|
| **مؤكدة من الكود** | `confirmed-by-code` | مأخوذة من قراءة الكود الفعلي | "Prisma schema يستخدم SQLite" |
| **مؤكدة من التوثيق** | `confirmed-by-docs` | مأخوذة من README أو docs رسمية | "Next.js 16 يستخدم Turbopack" |
| **مؤكدة من المستخدم** | `confirmed-by-user` | قالها المستخدم صراحة | "المشروع للعراق، ليس سوريا" |
| **استنتاج منطقي** | `inferred` | استنتاج من معلومات أخرى | "الـ container يقتل العمليات بسبب قيود الـ sandbox" |
| **اقتراح مستقبلي** | `proposal` | فكرة لم تُنفذ بعد | "استخدام AI Tutor للمساعدة" |
| **فكرة تحتاج تحقق** | `unverified` | معلومة غير مؤكدة | "قد يعمل PWA offline مع service worker" |

---

## 📝 كيفية الاستخدام

### في الـ YAML frontmatter
```yaml
---
confidence: confirmed-by-code
---
```

### في النص
```markdown
> **[مؤكدة من الكود]** Prisma يستخدم SQLite.
> **[استنتاج]** الـ container يقتل العمليات بسبب قيود الموارد.
> **[اقتراح مستقبلي]** يمكن إضافة AI Tutor لاحقاً.
```

---

## ⚠️ قواعد

1. **لا تكتب معلومة بدون مستوى ثقة**
2. **إذا تغير مستوى الثقة**، حدّثه
3. **إذا كانت المعلومة `unverified`**، خطط للتحقق منها
4. **لا تخلط** `confirmed` مع `inferred` في نفس الجملة
5. **إذا شككت في معلومة**، خفّض مستوى ثقتها

---

## 🔍 مرجع سريع

| المعلومة | المستوى |
|---------|--------|
| Prisma + SQLite | `confirmed-by-code` |
| العراق/IQD | `confirmed-by-user` |
| الـ container يقتل العمليات | `confirmed-by-code` (موثق في logs) |
| Supabase فشل بسبب camelCase | `confirmed-by-code` |
| Production build أسرع | `confirmed-by-code` (11ms vs 2-6s) |
| GitHub Pages للـ graphs | `confirmed-by-user` |
| AI Tutor مستقبلاً | `proposal` |
| PWA offline سيعمل | `unverified` |

---

## 🔗 الروابط

- [[00-Index]] — العودة للبوابة
- [[AI-Personality-Guide]] — كيف يكتب الـ AI التوثيق
