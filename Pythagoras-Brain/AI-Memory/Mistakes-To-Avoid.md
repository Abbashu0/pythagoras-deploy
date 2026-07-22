---
type: memory
category: mistakes
status: active
created: 2026-07-22
tags: [memory, mistakes, critical]
---

# أخطاء يجب تجنبها

## خطأ 1: تشغيل processes خلفية ثقيلة في الـ container

### الخطأ
تشغيل Graphify + Understand Anything + Next.js server في نفس الـ container.

### العاقبة
- الـ container يقتل العمليات بعد 45-60 ثانية
- الـ server ينطفئ باستمرار
- المستخدم لا يستطيع الوصول

### التصحيح
- **لا تشغل graphs في الـ container**
- انقلها لـ GitHub Pages أو خدمات خارجية
- الـ container فقط لـ Next.js server

---

## خطأ 2: استخدام `npm run dev` للمعاينة

### الخطأ
استخدام dev mode للمعاينة عبر preview URL.

### العاقبة
- استجابة بطيئة (2-6 ثوانٍ)
- compile عند الطلب يستهلك CPU
- الـ server يموت أسرع

### التصحيح
```bash
npm run build
node .next/standalone/server.js
```

---

## خطأ 3: تغيير الـ DB بدون سبب قوي

### الخطأ
الترحيل من Prisma+SQLite إلى Supabase (M1-M4).

### العاقبة
- فشل كامل (camelCase ↔ snake_case)
- إهدار وقت وجهد
- تراجع لـ commit قبل M1

### التصحيح
- **لا تغير الـ DB** إلا لسبب قوي جداً
- Prisma + SQLite كافي للمشروع الحالي
- إذا احتجنا PostgreSQL لاحقاً، استخدم Prisma معه (نفس الـ ORM)

---

## خطأ 4: عرض graphs كاملة في المتصفح

### الخطأ
عرض 10,115 nodes في الـ Understand Anything dashboard.

### العاقبة
- متصفح المستخدم يتعطل (OOM)
- شاشة سوداء بعد ثوانٍ

### التصحيح
- **فلتر لـ < 1000 node** للعرض
- استخدم static HTML (self-contained)
- أو انتقل لـ GitHub Pages

---

## خطأ 5: وضع `<button>` داخل `<button>`

### الخطأ
في `QuestionList.tsx`، زر خارجي يحتوي أزرار داخلية.

### العاقبة
- hydration error في React
- سلوك غير متوقع

### التصحيح
استخدم `<div role="button" tabIndex={0}>` للحاويات القابلة للنقر.

---

## خطأ 6: استخدام `raw.githubusercontent.com` للـ HTML

### الخطأ
محاولة عرض HTML من raw URL.

### العاقبة
- المتصفح يعرضه كـ text (لا يُنفّذ JS)
- المستخدم يرى كود بدلاً من صفحة

### التصحيح
- فعّل GitHub Pages
- أو استخدم `htmlpreview.github.io`

---

## خطأ 7: نسيان تحديث `.env` بعد مسحه

### الخطأ
`.env` يُمسح أحياناً، ثم نشغل الـ server بدونه.

### العاقبة
- `supabaseUrl is required`
- `DATABASE_URL` مفقود
- الـ server لا يعمل

### التصحيح
```bash
# تحقق قبل التشغيل
grep -c "DATABASE_URL" .env
# يجب أن يعيد 1 على الأقل
```

---

## خطأ 8: عدم استخدام `setsid` للفصل

### الخطأ
استخدام `nohup ... &` فقط (بدون setsid).

### العاقبة
- الـ process يُقتل عند انتهاء الـ shell
- الـ server يموت بعد كل tool call

### التصحيح
```bash
setsid node .next/standalone/server.js > dev.log 2>&1 &
disown
```

---

## خطأ 9: absolute paths في static HTML

### الخطأ
HTML يستخدم `/assets/index.js` (root absolute).

### العاقبة
- على GitHub Pages subpath → 404
- الـ assets لا تُحمّل

### التصحيح
- استخدم relative paths: `assets/index.js`
- أو استخدم prefix: `/pythagoras-deploy/assets/index.js`

---

## خطأ 10: عدم فلترة الـ functions في الـ graph

### الخطأ
تضمين كل الـ functions (9,794) في الـ Understand Anything graph.

### العاقبة
- حجم ضخم (6.3 MB)
- المتصفح يتعطل

### التصحيح
- احتفظ بكل الـ files + classes
- احتفظ بأعلى 200 function فقط (by connection count)
- النتيجة: 530 nodes، 316 KB

---

## خطأ 11: تجاهل الـ autosave daemon

### الخطأ
عدم انتظار ثانيتين بعد `git commit`.

### العاقبة
- الـ graphify hook يُطلق rebuild
- يستهلك CPU ويقتل أحياناً الـ server

### التصحيح
```bash
git commit -m "..."
sleep 2
# الآن شغّل الـ server
```

---

## خطأ 12: عدم استخدام `--allow-empty-message` عند الحاجة

### الخطأ
أحياناً الـ autosave daemon يفشل في commit بسبب رسالة فارغة.

### العاقبة
- التغييرات لا تُحفظ
- الـ daemon يتوقف

### التصحيح
```bash
git commit --allow-empty-message -m ""
```

---

## خطأ 13: الاعتماد على `localStorage` للـ session

### الخطأ
تخزين session في `localStorage` بدلاً من `sessionStorage` أو cookies.

### العاقبة
- الـ session يبقى حتى بعد إغلاق المتصفح
- مشاكل أمنية

### التصحيح
- استخدم `sessionStorage` للـ session المؤقت
- أو httpOnly cookies للـ auth

---

## خطأ 14: عدم تحديث `worklog.md`

### الخطأ
نسيان تحديث `worklog.md` بعد كل مهمة.

### العاقبة
- AI المستقبلي لا يعرف ما حدث
- تكرار للعمل

### التصحيح
- حدّث `worklog.md` بعد كل مهمة
- أو حدّث `[[Tasks]]` في Obsidian

---

## خطأ 15: نسيان `dir="rtl"`

### الخطأ
عدم إضافة `dir="rtl"` للعناصر العربية.

### العاقبة
- النص يظهر بالاتجاه الخاطئ
- تجربة مستخدم سيئة

### التصحيح
```tsx
<div dir="rtl">النص العربي</div>
```

---

## الروابط

- [[Lessons-Learned]]
- [[Patterns-To-Follow]]
- [[Problem-Log]]
