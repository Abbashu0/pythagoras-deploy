---
type: dna
status: active
created: 2026-07-22
confidence: confirmed-by-user
tags: [dna, principles, critical]
---

# 🧬 Project DNA — شخصية المشروع

> **هذا الملف يصف شخصية المشروع، ليس الكود.**
> أي نموذج جديد يجب أن يقرأ هذا الملف أولاً قبل البدء.

## 🎯 فلسفة المنتج

### ما هو Pythagoras؟
منصة تعليمية لطلاب **السادس الإعدادي في العراق** — تساعدهم في المراجعة وحل الأسئلة ومتابعة التقدم.

### لماذا موجود؟
> لأن الطالب العراقي يستحق منصة عربية عالية الجودة، مصممة خصيصاً له، بعملة بلده، بلغته.

### ما الذي يميزنا؟
1. **عربي 100%** — RTL، محتوى عربي حقيقي
2. **خفيف وسريع** — يعمل على أجهزة ضعيفة
3. **محتوى محلي** — موافق للمنهاج العراقي
4. **عملة محلية** — دينار عراقي (IQD)

---

## ⛔ خطوط حمراء (لا تكسرها أبداً)

### 1. العربية أولاً
- كل الواجهة بالعربية
- `dir="rtl"` إلزامي
- لا ترجمات آلية — محتوى عربي حقيقي

### 2. العراق هو السوق
- الدولة: العراق (ليس سوريا، ليس مصر، ليس السعودية)
- العملة: دينار عراقي (IQD)
- المنهاج: العراقي

### 3. لا تغير الـ DB بدون سبب قوي
- Prisma + SQLite هو الاختيار
- لا Supabase، لا Firebase، لا PostgreSQL
- سبب الفشل موثق: [[Problem-Log#مشكلة 2: Supabase Migration Failure]]

### 4. لا تثقل الـ Container
- الـ server خفيف (Next.js فقط)
- الـ graphs على GitHub Pages
- لا processes خلفية ثقيلة

### 5. Production Build للمعاينة
- لا تستخدم `npm run dev` للمعاينة
- استخدم `npm run build` + `npm run start`
- السبب: [[Lessons-Learned#درس 1: Production Build أفضل من Dev Mode]]

---

## 🏛️ المبادئ التصميمية

### البساطة أولاً
- لا تضف تعقيداً بدون فائدة واضحة
- الـ student app = Vanilla JS (خفيف)
- الـ admin = Next.js (قوي)

### فصل الاهتمامات
- **تطبيق الطالب**: `public/pythagoras/` — قراءة فقط
- **لوحة الأدمن**: `src/` — إدارة المحتوى
- **API**: `src/app/api/` — جسر بينهما

### إعادة الاستخدام
- لا تنشئ component جديد إذا كان يوجد ما يمكن إعادة استخدامه
- استخدم Graphify للبحث قبل الإنشاء

### التوثيق الحي
- الكود يشرح **كيف** يعمل التطبيق
- الـ Second Brain يشرح **لماذا** يعمل بهذه الطريقة
- كلاهما مهم بنفس القدر

---

## 🎨 فلسفة تجربة المستخدم

### للطالب
- **سريع** — الصفحة تُحمّل في < 3 ثوانٍ
- **بسيط** — لا تشتيت، تركيز على المحتوى
- **مفيد** — إجابة فورية، شرح واضح

### للأدمن
- **كفؤ** — أقل عدد من النقرات لإنجاز المهمة
- **آمن** — تأكيد قبل الحذف، undo حيث ممكن
- **واضح** — status badges، validation messages

### عام
- **RTL** دائماً
- **عربي** دائماً
- **تصميم متجاوب** (mobile-first)

---

## 🔄 فلسفة إعادة الاستخدام

### قبل إنشاء أي شيء جديد
1. ابحث في Graphify: `graphify query "keyword"`
2. ابحث في Understand Anything dashboard
3. ابحث في [[Application-Encyclopedia]]
4. إذا وجدت شيئاً قابلاً لإعادة الاستخدام → استخدمه
5. إذا لم تجد → أنشئ جديداً ووثّقه

### مكونات قابلة لإعادة الاستخدام
- `Card`, `Button`, `Input`, `Textarea` — shadcn/ui
- `AdminPageLayout` — لصفحات الـ admin
- `AdminShell` — الـ shell الرئيسي

---

## 📊 جودة الكود المطلوبة

### مستوى مقبول
- **TypeScript** — لا `any` إلا للـ D3 (استثناء موثق)
- **ESLint** — لا أخطاء
- **no console errors** — في المتصفح
- **RTL** — كل النصوص العربية

### مستوى مفضل
- **Tests** — للمكونات الحرجة
- **JSDoc** — للدوال المعقدة
- **Error boundaries** — لمنع crash كامل

### مستوى غير مقبول
- `<button>` داخل `<button>` — [[Mistakes-To-Avoid#خطأ 5: وضع `<button>` داخل `<button>`]]
- `localStorage` للـ JWT — استخدم httpOnly cookies
- absolute paths في static HTML على subpath

---

## 🚫 الأشياء المرفوضة (لا تقترحها)

راجع: [[Anti-Repetition-Brain]]

- ❌ Supabase migration (فشل مرتين)
- ❌ Firebase (يتطلب billing)
- ❌ Dev mode للمعاينة (بطيء وغير مستقر)
- ❌ Graphs في الـ container (تقتله)
- ❌ LivePreviewPanel (كسر صفحات أخرى)

---

## ✅ الأشياء المثبتة (استمر عليها)

- ✅ Prisma + SQLite
- ✅ Next.js 16 + Turbopack + standalone output
- ✅ shadcn/ui + Tailwind CSS
- ✅ Vanilla JS للطالب
- ✅ GitHub Pages للـ graphs
- ✅ Obsidian للـ second brain
- ✅ Production build للمعاينة

---

## 📐 فلسفة العمل

### التفكير قبل التنفيذ
1. اقرأ الـ memory أولاً
2. ابحث في الكود بـ Graphify
3. افهم بـ Understand Anything
4. خطط قبل أن تكتب
5. اختبر بعد أن تكتب
6. وثّق بعد أن تنجح

### الصراحة مع المستخدم
- إذا فشل شيء، قل ذلك بصدق
- لا تخدع المستخدم بحلول وهمية
- إذا لم تعرف، قل "لا أعرف"

### الواقعية
- تقبّل قيود الـ container
- لا تعد بأشياء لا أستطيع تنفيذها
- ركّز على ما يعمل، ليس على ما هو مثالي

---

## 🔗 الروابط

- [[AI-Personality-Guide]] — كيف يعمل الـ AI
- [[Design-Language-Bible]] — فلسفة التصميم
- [[Application-Encyclopedia]] — مرجع التطبيق
- [[Anti-Repetition-Brain]] — ما رفضناه
- [[00-Index]] — العودة للبوابة
