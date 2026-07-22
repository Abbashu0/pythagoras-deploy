---
type: problem-log
status: active
created: 2026-07-22
tags: [problems, solutions]
---

# سجل المشاكل والحلول

## مشكلة 1: Container Process Killing

### الوصف
الـ container يقتل أي process خلفي بعد 45-60 ثانية.

### السبب
- قيود في الـ sandbox environment
- لا يوجد systemd (tini هو PID 1)
- العمليات الخلفية تُقتل عند انتهاء الـ shell session

### الاكتشاف
- `nohup` + `&` لا يكفي
- `setsid` يفصل الـ process لكنه يُقتل أيضاً
- `disown` لا يساعد

### الحل الناجح
**تشغيل ping loop مستمر** في نفس الـ tool call:
```bash
setsid node .next/standalone/server.js &
for i in $(seq 1 18); do
  sleep 30
  curl -s http://127.0.0.1:3000/api/health > /dev/null
done
```
هذا يبقي الـ server نشطاً لـ 9 دقائق (الحد الأقصى للـ tool call).

### كيف نتجنبها مستقبلاً
- **لا تشغل processes خلفية ثقيلة** (graphs, viewers)
- **استخدم production build** (أسرع = أقل وقت عرضة للقتل)
- **انقل العمليات الثقيلة لـ GitHub Pages** أو خدمات خارجية

---

## مشكلة 2: Supabase Migration Failure

### الوصف
محاولة ترحيل Firebase → Supabase فشلت بالكامل (M1-M4).

### السبب
1. **camelCase ↔ snake_case:** الـ entities تستخدم camelCase (`subjectId`) لكن SQL يستخدم snake_case (`subject_id`)
2. **تعقيد غير ضروري:** إضافة طبقة تحويل لكل query
3. **RLS policies:** تكرار في الـ schema.sql
4. **الـ container لا يتعامل جيداً مع external DB**

### الاكتشاف
- أخطاء `42710: policy already exists` في Supabase
- `supabaseUrl is required` عند مسح `.env`
- استجابات بطيئة من Supabase

### الحل
**التراجع الكامل:** `git reset --hard 406b662` (قبل M1)
- العودة لـ Prisma + SQLite
- لا Supabase، لا Firebase

### كيف نتجنبها مستقبلاً
- **لا نغير الـ DB** إلا لسبب قوي جداً
- **Prisma + SQLite كافي** للمشروع الحالي
- إذا احتجنا PostgreSQL لاحقاً، نستخدم Prisma معه (نفس الـ ORM)

---

## مشكلة 3: Understand Anything Browser Crash

### الوصف
الـ dashboard يعرض الـ graph للحظة ثم يتعطل (شاشة سوداء).

### السبب
- الـ graph كان 10,115 nodes (9,794 functions!)
- حجم الملف 6.3 MB
- المتصفح يستهلك كل الذاكرة → OOM crash

### الاكتشاف
- المستخدم أرسل screenshot يظهر "Missing or invalid project metadata"
- لكن السبب الحقيقي كان memory spike

### الحل
**فلترة الـ graph:**
- كل الـ files (256) — محتفظ بها
- كل الـ classes (65) — محتفظ بها
- أعلى 200 function بالاتصالات — محتفظ بها
- بقية الـ functions — محذوفة

النتيجة: 530 nodes، 316 KB (بدلاً من 6.3 MB)

### كيف نتجنبها مستقبلاً
- **لا تعرض graphs كاملة في المتصفح** إلا إذا كان < 1000 node
- **استخدم static HTML** (self-contained) بدلاً من fetch ديناميكي
- **انتقل لـ GitHub Pages** للـ graphs الكبيرة

---

## مشكلة 4: HTML Nested Button Error

### الوصف
خطأ hydration: `<button> cannot be a descendant of <button>`.

### السبب
في `QuestionList.tsx`، زر خارجي (السؤال كامل) يحتوي على أزرار داخلية (up/down/delete).

### الاكتشاف
Console error في المتصفح عند فتح `/admin/content/[id]`.

### الحل
تحويل الزر الخارجي إلى `<div>` مع `role="button"` و `tabIndex={0}` و `onKeyDown`.

### كيف نتجنبها مستقبلاً
- **لا تضع `<button>` داخل `<button>`**
- استخدم `<div role="button">` للحاويات القابلة للنقر

---

## مشكلة 5: GitHub Pages Raw URL لا يعرض HTML

### الوصف
`raw.githubusercontent.com` يعرض HTML كـ text، لا يُنفّذ.

### السبب
GitHub raw يعيد `Content-Type: text/plain`، المتصفح لا يُنفّذ الـ JS.

### الحل
**تفعيل GitHub Pages** (Settings → Pages → gh-pages branch).
ثم الـ URL يصبح `abbashu0.github.io/pythagoras-deploy/` ويُخدم كـ HTML حقيقي.

### كيف نتجنبها مستقبلاً
- **استخدم GitHub Pages** للـ static HTML
- **لا تستخدم raw URLs** للعرض

---

## مشكلة 6: Graphify Hook يقتل العمليات

### الوصف
بعد كل `git commit`، الـ graphify hook يُطلق rebuild في الخلفية، مما يقتل أحياناً الـ server.

### السبب
الـ hook يشغل `graphify . --code-only` الذي يستهلك CPU وذاكرة.

### الحل
الـ hook يستخدم `subprocess.Popen` مع `start_new_session=True` (detached).

### كيف نتجنبها مستقبلاً
- **انتظر ثانيتين بعد كل commit** قبل تشغيل الـ server
- **لا تشغل rebuild أثناء استخدام الـ server**

---

## مشكلة 7: .env يتم مسحه

### الوصف
ملف `.env` يُمسح أحياناً (يعود لـ `DATABASE_URL` فقط بدون Supabase keys).

### السبب
- الـ autosave daemon قد يستثني `.env`
- إعادة تهيئة الـ container تمسح الملفات غير المتتبَّعة

### الحل
1. حماية `.env` بـ `chmod 444` (read-only)
2. الاحتفاظ بنسخة احتياطية في git history
3. استرجاع سريع: `git show 42f7fb2:.env > .env`

### كيف نتجنبها مستقبلاً
- **تحقق من `.env` قبل كل تشغيل**
- `grep -c SUPABASE .env` يجب أن يعيد > 0 (إذا استخدمنا Supabase)
- **لا تعتمد على `.env` للـ secrets** في الـ container

---

## الروابط

- [[Mistakes-To-Avoid]]
- [[Lessons-Learned]]
- [[Architecture-Decisions]]
