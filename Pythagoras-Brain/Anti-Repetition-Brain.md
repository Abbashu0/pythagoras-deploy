---
type: anti-repetition
status: active
created: 2026-07-22
confidence: confirmed-by-user
tags: [memory, rejected, critical]
---

# 🚫 Anti-Repetition Brain — أفكار رُفضت

> **قبل اقتراح أي فكرة جديدة، راجع هذا الملف.**
> **إذا رفض المستخدم فكرة، سجّلها هنا.**

## ❌ Supabase Migration

### ما رُفض
ترحيل قاعدة البيانات من Prisma+SQLite إلى Supabase (PostgreSQL).

### لماذا رُفض
- مشاكل camelCase ↔ snake_case
- تعقيد إضافي بدون فائدة
- الـ container لا يتعامل جيداً مع external DB
- فشل مرتين (M1-M4 كاملة)

### متى يمكن إعادة اقتراحه
- **أبداً** — إلا إذا تغيّرت المتطلبات جذرياً
- إذا احتجنا multi-region أو real-time sync
- حتى حينها، استخدم Prisma مع PostgreSQL (نفس الـ ORM)

### التفاصيل
[[Problem-Log#مشكلة 2: Supabase Migration Failure]]
[[ADR-001-Prisma-SQLite]]

---

## ❌ Firebase

### ما رُفض
استخدام Firebase كـ backend.

### لماذا رُفض
- يتطلب billing account حتى للنطاق المجاني
- لا يدعم RTL بشكل جيد في الـ console
- vendor lock-in

### متى يمكن إعادة اقتراحه
- إذا أردنا push notifications للـ mobile
- لكن حتى حينها، استخدم FCM فقط، ليس كل Firebase

---

## ❌ Dev Mode للمعاينة

### ما رُفض
استخدام `npm run dev` لمعاينة التطبيق عبر preview URL.

### لماذا رُفض
- بطيء (2-6 ثوانٍ لكل صفحة)
- compile عند الطلب يستهلك CPU
- الـ server يموت أسرع
- المستخدم يرى أخطاء compile

### متى يمكن إعادة اقتراحه
- **أبداً** — production build كافٍ دائماً
- إلا إذا احتجنا hot reload سريع أثناء التطوير (لكن ليس للمعاينة)

---

## ❌ Graphs في الـ Container

### ما رُفض
خدمة Graphify + Understand Anything graphs من الـ Next.js server.

### لماذا رُفض
- الـ graphs ثقيلة (1.7MB - 6.3MB)
- تقتل الـ container (memory spike)
- الـ server ينطفئ باستمرار

### متى يمكن إعادة اقتراحه
- إذا انتقلنا لـ VPS قوي
- لكن حتى حينها، GitHub Pages أفضل (CDN مجاني)

---

## ❌ LivePreviewPanel

### ما رُفض
معاينة حية للبانرات داخل صفحات navigation/tools.

### لماذا رُفض
- كسر صفحات `/admin/navigation` و `/admin/tools`
- تعقيد بدون فائدة كبيرة

### متى يمكن إعادة اقتراحه
- إذا أعاد المستخدم طلبها صراحة
- لكن بطريقة لا تكسر الصفحات الأخرى

---

## ❌ Understand Anything Dashboard في الـ Container

### ما رُفض
تشغيل Understand Anything viewer server على port 5174.

### لماذا رُفض
- الـ viewer يموت مع الـ container
- تعقيد إضافي (port إضافي، proxy)
- GitHub Pages أفضل

### متى يمكن إعادة اقتراحه
- **أبداً** — GitHub Pages يعمل بشكل ممتاز

---

## ❌ وضع `localStorage` للـ JWT

### ما رُفض
تخزين JWT tokens في `localStorage`.

### لماذا رُفض
- XSS يمكنه سرقة الـ token
- أقل أماناً من httpOnly cookies

### متى يمكن إعادة اقتراحه
- **أبداً** — استخدم httpOnly cookies دائماً

---

## ❌ زر داخل زر (`<button>` في `<button>`)

### ما رُفض
عنصر `<button>` يحتوي على `<button>` بداخله.

### لماذا رُفض
- خطأ hydration في React
- HTML غير صحيح

### متى يمكن إعادة اقتراحه
- **أبداً** — استخدم `<div role="button">` بدلاً منه

---

## ❌ عرض 10,000+ nodes في المتصفح

### ما رُفض
عرض الـ graph كاملاً (10,115 nodes) في Understand Anything dashboard.

### لماذا رُفض
- المتصفح يتعطل (OOM)
- شاشة سوداء بعد ثوانٍ

### متى يمكن إعادة اقتراحه
- **أبداً** — فلتر لـ < 1,000 node دائماً

---

## 📝 كيفية الإضافة لهذا الملف

عند رفض فكرة من المستخدم:

```markdown
## ❌ [اسم الفكرة]

### ما رُفض
[وصف ما رُفض بالضبط]

### لماذا رُفض
[أسباب الرفض]

### متى يمكن إعادة اقتراحه
[شروط إعادة الاقتراح، أو "أبداً"]

### التفاصيل
[[رابط للملف ذي الصلة]]
```

---

## 🔗 الروابط

- [[Mistakes-To-Avoid]] — أخطاء يجب تجنبها
- [[Problem-Log]] — سجل المشاكل
- [[Why-Log]] — لماذا اتخذنا القرارات
- [[00-Index]] — العودة للبوابة
