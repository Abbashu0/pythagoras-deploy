---
type: design-bible
status: active
created: 2026-07-22
confidence: confirmed-by-code
tags: [design, philosophy, critical]
---

# 🎨 Design Language Bible — فلسفة التصميم

> **هذا ليس فقط ألوان وخطوط. هذا فلسفة التصميم الكاملة.**

## 🎯 الفلسفة الأساسية

### "بساطة مع شخصية"
- بساطة Material Design
- شخصية Linear/Vercel
- دقة Apple

### المبادئ
1. **الوضوح أولاً** — المستخدم يجب أن يفهم فوراً
2. **السرعة إلزامية** — لا انتظار بدون سبب
3. **التغذية الراجعة فورية** — كل تفاعل له رد
4. **الأخطاء صديقة** — لا توبخ المستخدم
5. **التفاصيل الصغيرة مهمة** — hover states، transitions، micro-interactions

---

## 🏗️ نظام الألوان

### Primary
```css
--primary: #6366f1 (indigo-500)
--primary-foreground: #ffffff
```

### Status Colors
| الحالة | اللون | الاستخدام |
|------|------|---------|
| Success | `#22c55e` (green-500) | عمليات ناجحة |
| Warning | `#f59e0b` (amber-500) | تحذيرات |
| Error | `#ef4444` (red-500) | أخطاء |
| Info | `#3b82f6` (blue-500) | معلومات |

### Subject Colors (للمواد)
| المادة | اللون |
|--------|------|
| الرياضيات | `#3b82f6` (blue) |
| الفيزياء | `#ef4444` (red) |
| الكيمياء | `#10b981` (green) |
| الأحياء | `#22c55e` (green) |
| العربية | `#a855f7` (purple) |
| الإنكليزية | `#0ea5e9` (sky) |

---

## ✍️ Typography

### الخطوط
- **Latin**: Inter (300, 400, 500, 600)
- **العربية**: Noto Sans Arabic / Cairo
- **Code**: JetBrains Mono

### الأحجام
| المستوى | الحجم | الاستخدام |
|--------|------|---------|
| H1 | `text-2xl` (24px) | عناوين الصفحات |
| H2 | `text-xl` (20px) | أقسام رئيسية |
| H3 | `text-lg` (18px) | أقسام فرعية |
| Body | `text-sm` (14px) | النص العادي |
| Caption | `text-xs` (12px) | تلميحات |
| Micro | `text-[10px]` | badges |

---

## 🎬 فلسفة الحركة (Motion)

### المبدأ
> **الحركة يجب أن تكون ملحوظة لكن ليست مزعجة.**

### الانتقالات (Transitions)
```css
/* الافتراضي */
transition: all 0.2s ease;

/* للأشياء الكبيرة */
transition: all 0.3s ease;
```

### ما يتحرك
- ✅ Hover states (تغيير لون/حجم خفيف)
- ✅ Toggling panels (slide in/out)
- ✅ Loading spinners
- ✅ Toast notifications (slide from top)
- ✅ Modal dialogs (fade + scale)

### ما لا يتحرك
- ❌ النصوص أثناء القراءة
- ❌ الجداول أثناء التصفح
- ❌ أي شيء يشتت عن المحتوى

---

## 🔄 فلسفة التغذية الراجعة (Feedback)

### القاعدة الذهبية
> **كل تفاعل يجب أن يخبر المستخدم "سمعتك وعملت طلبك".**

### أنواع التغذية الراجعة

#### 1. فورية (< 100ms)
- Button hover/active states
- Cursor changes
- Focus rings

#### 2. قصيرة (< 1s)
- Loading spinners
- Button disabled states
- Optimistic UI updates

#### 3. متوسطة (1-3s)
- Toast notifications
- Progress bars
- Skeleton screens

#### 4. طويلة (> 3s)
- Progress with percentage
- "جارٍ المعالجة..." messages
- Background task indicators

---

## ⚠️ فلسفة الأخطاء (Error Handling)

### المستوى 1: منع الخطأ
- Validation قبل الإرسال
- Disabled buttons عند عدم اكتمال البيانات
- Confirm dialogs للعمليات الخطرة

### المستوى 2: رسالة خطأ واضحة
- ❌ "حدث خطأ" (سيء)
- ✅ "فشل إنشاء الحزمة: المادة مطلوبة" (جيد)
- ✅ "تعذّر الاتصال بالخادم. تحقق من اتصالك." (ممتاز)

### المستوى 3: حل مقترح
- "لم تُحدد مادة. اختر واحدة من القائمة."
- "البريد مستخدم بالفعل. هل تريد تسجيل الدخول؟"

### المستوى 4: recovery
- Undo button بعد الحذف
- "إعادة المحاولة" بعد الفشل

---

## 📱 فلسفة التحميل (Loading)

### Skeleton Screens (مفضّلة)
- تظهر بنية الصفحة فوراً
- محتوى رمادي مكان البيانات
- انتقال سلس عند وصول البيانات

### Spinners
- للعمليات القصيرة (< 2s)
- حجم صغير (16-24px)
- لون primary

### Progress Bars
- للعمليات الطويلة (> 3s)
- تظهر نسبة التقدم
- "جارٍ رفع 3 من 10 ملفات..."

### ما يجب تجنبه
- ❌ صفحة بيضاء أثناء التحميل
- ❌ spinners كبيرة تملأ الشاشة
- ❌ "Loading..." بدون أي معلومة

---

## 🖱️ فلسفة التفاعل (Interaction)

### النقر (Click)
- منطقة نقر كافية (44x44px على الأقل للموبايل)
- hover state واضح
- active state (scale down قليلاً)

### السحب (Drag)
- مؤشر grab/grabbing
- placeholder أثناء السحب
- snap to position

### الكتابة (Input)
- debounce للبحث (300ms)
- clear button للحقول الطويلة
- char count للحقول المحدودة

### الاختصارات (Shortcuts)
- Ctrl+K للبحث السريع
- Escape لإغلاق النوافذ
- Enter للتأكيد

---

## 📐 فلسفة البساطة (Simplicity)

### القاعدة
> **إذا احتاج المستخدم تعليمات لفهم الواجهة، فالتصميم فاشل.**

### كيف نحققها
1. **وظيفة واضحة** — كل عنصر يوضح وظيفته
2. **هرمية بصرية** — الأهم أكبر/أبرز
3. **مساحة بيضاء** — لا ازدحام
4. **حد أقصى من الخيارات** — لا ت_OVERFLOW المستخدم
5. **تقدم تدريجي** — ابدأ بسيطاً، أضف تعقيداً عند الحاجة

---

## 🔍 فلسفة التفاصيل الصغيرة (Micro-interactions)

### أمثلة
- **Copy button** — يتغير لأيقونة ✓ لمدة ثانيتين
- **Save indicator** — "محفوظ" يظهر ويختفي
- **Dirty state** — نقطة صغيرة بجانب الحقول غير المحفوظة
- **Drag handle** — يظهر فقط عند hover
- **Empty states** — رسائل ودودة عند عدم وجود بيانات

### الهدف
> **المستخدم يشعر أن التطبيق حيّ ويستجيب له، ليس مجرد صفحة جامدة.**

---

## 🌐 فلسفة RTL (Right-to-Left)

### القاعدة
> **كل شيء يجب أن يعمل بشكل طبيعي بالعربية.**

### التطبيق
- `dir="rtl"` على الـ HTML root
- الأيقونات تنعكس (chevron-right → chevron-left)
- الـ sidebar على اليمين
- الـ text-align: right افتراضياً
- Margins/paddings تستخدم logical properties (`ms-`, `me-`)

---

## 📦 فلسفة المكونات (Components)

### الحجم
- **صغير** (Button, Input, Badge) — قابل لإعادة الاستخدام
- **متوسط** (Card, Modal, Table) — مركّب من صغار
- **كبير** (Page, Layout) — مركّب من متوسطات

### التسمية
- **PascalCase** للمكونات (`AdminSidebar`)
- **kebab-case** للملفات (`admin-sidebar.tsx`)
- **clear names** — لا اختصارات غامضة

### الـ Props
- **required** للأساسي
- **optional with default** للثانوي
- **never more than 7 props** — إذا زاد، قسم المكون

---

## 🔗 الروابط

- [[Project-DNA]] — شخصية المشروع
- [[AI-Personality-Guide]] — كيف يعمل الـ AI
- [[Application-Encyclopedia]] — مرجع التطبيق
- [[UX-Decisions]] — قرارات UX
- [[00-Index]] — العودة للبوابة
