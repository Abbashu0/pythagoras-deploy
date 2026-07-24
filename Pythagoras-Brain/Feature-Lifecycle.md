---
type: feature-lifecycle
status: active
created: 2026-07-22
confidence: confirmed-by-code
tags: [features, lifecycle, reference]
---

# 🔄 Feature Lifecycle — دورة حياة الميزات

> **كل ميزة في المشروع تمر بدورة حياة واضحة.**
> **يجب أن يعرف أي AI الحالة الحالية لكل ميزة.**

## 📊 الحالات

```
Idea → Research → Approved → Design → Implementation → Testing → Released → Improved → Deprecated
```

| الحالة | الوصف | اللون |
|--------|------|------|
| 💡 Idea | فكرة أولية | رمادي |
| 🔍 Research | قيد الدراسة | أزرق |
| ✅ Approved | تمت الموافقة | أخضر فاتح |
| 🎨 Design | قيد التصميم | بنفسجي |
| 🔨 Implementation | قيد التنفيذ | برتقالي |
| 🧪 Testing | قيد الاختبار | أصفر |
| 🚀 Released | منشورة | أخضر |
| 📈 Improved | تم تحسينها | سماوي |
| ⚰️ Deprecated | مهجورة | أحمر |

---

## 📋 الميزات الحالية

### Admin Panel
- **الحالة:** 🚀 Released
- **الوصف:** لوحة إدارة كاملة (Dashboard, Banners, Users, Premium, Analytics, Materials, Navigation, Tools, Graphify)
- **الملف:** [[Application-Encyclopedia#صفحات الـ Admin]]

### Banner System
- **الحالة:** 🚀 Released
- **الوصف:** نظام بانرات مع scheduling و destinations و archive
- **الملف:** [[Application-Encyclopedia#/admin/banners]]

### Health Dashboard
- **الحالة:** 🚀 Released
- **الوصف:** فحوصات حية لصحة النظام
- **الملف:** [[Application-Encyclopedia#/admin/analytics]]

### Knowledge Graph (Graphify + Understand Anything)
- **الحالة:** 🚀 Released
- **الوصف:** graphs على GitHub Pages
- **الملف:** [[Technology-Decisions#Graphify]]

### Obsidian Second Brain
- **الحالة:** 🚀 Released
- **الوصف:** هذا الـ vault
- **الملف:** [[00-Index]]

---

### Content Studio (M9)
- **الحالة:** 💡 Idea (بعد التراجع عن M1-M4)
- **الوصف:** إدارة المواد والأقسام والحزم والأسئلة
- **الانتظار:** إعادة بناء بـ Prisma+SQLite
- **الملف:** [[Future-Features#M9: Content Studio (إعادة بناء)]]

### Auth System (M10)
- **الحالة:** 💡 Idea
- **الوصف:** تسجيل دخول للطلاب والأدمن
- **الملف:** [[Future-Features#M10: نظام المصادقة]]

### Student App Integration (M11)
- **الحالة:** 💡 Idea
- **الوصف:** ربط تطبيق الطالب بـ API حقيقي
- **الملف:** [[Future-Features#M11: تطبيق الطالب الكامل]]

### Premium System (M12)
- **الحالة:** 💡 Idea
- **الوصف:** بوابات دفع عراقية + اشتراكات
- **الملف:** [[Future-Features#M12: نظام Premium]]

---

## ⚰️ الميزات المهجورة

### M1-M4 + Supabase Migration
- **الحالة:** ⚰️ Deprecated
- **السبب:** فشل كامل
- **التفاصيل:** [[Problem-Log#مشكلة 2: Supabase Migration Failure]]

### LivePreviewPanel
- **الحالة:** ⚰️ Deprecated
- **السبب:** كسر صفحات أخرى
- **التفاصيل:** [[Anti-Repetition-Brain#❌ LivePreviewPanel]]

### In-app Graph Viewer
- **الحالة:** ⚰️ Deprecated
- **السبب:** يقتل الـ container
- **البديل:** GitHub Pages
- **التفاصيل:** [[Anti-Repetition-Brain#❌ Graphs في الـ Container]]

---

## 📝 كيفية الإضافة

عند إضافة ميزة جديدة:

```markdown
### [اسم الميزة]
- **الحالة:** [أحد الحالات]
- **الوصف:** [ما تفعله]
- **الملف:** [[رابط]]
```

عند تغيير حالة ميزة:
1. حدّث الحالة هنا
2. أضف event في [[Timeline]]
3. حدّث [[Application-Encyclopedia]] إذا تم إصدارها

---

## 🔗 الروابط

- [[Future-Features]] — ميزات مستقبلية
- [[Ideas]] — أفكار
- [[Timeline]] — سجل زمني
- [[00-Index]] — العودة للبوابة
