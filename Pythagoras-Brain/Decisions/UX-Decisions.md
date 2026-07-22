---
type: decision
category: ux
status: active
created: 2026-07-22
tags: [decisions, ux]
---

# قرارات UX

## العربية أولاً (RTL)

### القرار
كل الواجهة بالعربية، اتجاه RTL.

### التفاصيل
- `dir="rtl"` على الـ HTML root
- النصوص بالعربية
- الأيقونات تنعكس حسب الاتجاه
- الـ sidebar على اليمين

### السبب
الجمهور المستهدف: طلاب عراقيون. العربية لغتهم الأم.

---

## العراق بدلاً من سوريا

### القرار
- الدولة: العراق (ليس سوريا)
- العملة: الدينار العراقي (IQD)
- كانت SYP (Syrian Pounds) — غُيّرت في `prisma/schema.prisma`

### التاريخ
- **2026-07-22:** تغيير من SYP → IQD
- **السبب:** المستخدم أوضح أن المشروع للعراق

### ما يجب الانتباه له
- أي إشارة لدولة/عملة مستقبلية → العراق/IQD
- لا توجد مراجع أخرى لسوريا في الكود (تم التحقق)

---

## عدم استخدام LivePreviewPanel

### القرار
ألغينا `LivePreviewPanel` (كانت تعرض معاينة حية للبانرات).

### السبب
- كسرت صفحات `/admin/navigation` و `/admin/tools`
- تعقيد بدون فائدة كبيرة
- الـ commit `d55f880` تراجع عنها

### البديل
معاينة عادية (غير حية) كافية.

---

## أزرار "فتح العرض التفاعلي" في GitHub Pages

### القرار
أزرار الـ graphs في `/admin/graphify` تفتح GitHub Pages في **tab جديد**.

### السبب
- لا تثقل الـ container
- الـ graphs تعمل بشكل مستقل
- المستخدم يرى الـ graph كاملاً

### التنفيذ
```tsx
window.open("https://abbashu0.github.io/pythagoras-deploy/graphify.html", "_blank")
```

---

## تصميم الـ Package Cards

### القرار
`PackageCard` يحتوي على:
- اسم الحزمة + أيقونة + لون
- المادة + القسم + الموضوع
- عدد الأسئلة + الموارد
- حالة (draft/published/archived)
- إصدار + schema version
- آخر تعديل + آخر نشر
- حالة التحقق
- أزرار سريعة (فتح، تكرار، أرشفة، حذف)

### السبب
مستوحى من Figma file cards و Linear project cards.

---

## الألوان والـ Typography

### القرار
- **Primary:** indigo (`#6366f1`)
- **Background:** white (light mode)
- **Font:** Inter (latin) + Noto Sans Arabic
- **Code:** JetBrains Mono

### السبب
- حديث ونظيف
- يدعم العربية جيداً
- متوفر على Google Fonts

---

## الروابط

- [[Architecture-Decisions]]
- [[Technology-Decisions]]
- [[Mistakes-To-Avoid]]
