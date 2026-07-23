---
type: workflow
status: active
created: 2026-07-22
tags: [workflow, critical, process]
---

# Workflow المتكامل — Obsidian + Graphify + Understand Anything

## 🎯 الفلسفة

ثلاث طبقات من المعرفة:

```
┌─────────────────────────────────────────────────────────────┐
│                    طبقات فهم المشروع                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Obsidian (ذاكرة طويلة المدى)                             │
│     ↓ ماذا حدث؟ لماذا؟ ماذا تعلمنا؟                          │
│                                                              │
│  2. Graphify (فهم بنيوي سريع)                                │
│     ↓ ما هي علاقات الكود؟ من يستدعي من؟                      │
│                                                              │
│  3. Understand Anything (فهم دلالي عميق)                     │
│     ↓ كيف يعمل كل ملف؟ ما وظيفته؟                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 📋 الـ Workflow الكامل

### 🔵 مرحلة 1: قبل أي مهمة تطوير

#### 1.1 اقرأ الـ Memory أولاً

```
ابدأ دائماً بقراءة:
1. [[Mistakes-To-Avoid]] — لا تكرر أخطاء سابقة (مهم!)
2. [[Decisions]] ذات الصلة بالمهمة
3. [[Problem-Log]] للمشاكل المشابهة
4. [[Tasks]] لمعرفة الحالة الحالية
```

#### 1.2 استخدم Graphify للبحث السريع

```bash
# إذا سُئلت: "كيف يعمل نظام البانرات؟"
graphify query "banners"

# لمعرفة من يستدعي دالة معينة
graphify explain "AdminSidebar"

# لتتبع مسار بين مكونين
graphify path "AdminTopBar" "useToast"

# لعرض كل الملفات المرتبطة بكلمة
graphify search "banner"
```

#### 1.3 استخدم Understand Anything للفهم العميق

افتح: https://abbashu0.github.io/pythagoras-deploy/understand-anything/

- **Structural view** — شجرة الملفات والعلاقات
- **Search** — ابحث عن أي ملف/dالة
- **Click على node** → يعرض:
  - الشرح
  - الاتصالات (imports, calls)
  - نوع الـ node (file, function, class)
  - التعقيد
- **Tour mode** — جولة إرشادية للـ architecture

#### 1.4 حدد نطاق المهمة

بعد القراءة:
- **ما هي الملفات المتأثرة؟** (من Graphify)
- **ما هي العلاقات؟** (من Understand Anything)
- **ما الأخطاء السابقة في هذا المجال؟** (من Obsidian)
- **ما القرارات السابقة؟** (من Obsidian)

---

### 🟢 مرحلة 2: أثناء التنفيذ

#### 2.1 اقرأ أقل عدد ممكن من الملفات

- استخدم Graphify لتحديد الملفات بدقة
- استخدم Understand Anything لفهمها قبل القراءة
- اقرأ الملف فقط إذا احتجت تفاصيل دقيقة

#### 2.2 لا تنشئ مكونات/خدمات جديدة إذا كان يوجد ما يمكن إعادة استخدامه

```bash
# قبل إنشاء component جديد
graphify query "component similar to X"

# قبل إنشاء function جديدة
graphify search "function name"
```

#### 2.3 اتبع الأنماط الموجودة

راجع: [[Patterns-To-Follow]]

---

### 🟡 مرحلة 3: بعد الانتهاء (إلزامي!)

#### 3.1 اختبر

```bash
# شغّل الـ server
npm run build
node .next/standalone/server.js

# اختبر الـ endpoints
curl http://127.0.0.1:3000/api/health
```

#### 3.2 حدّث Graphify (تلقائي)

```bash
git add -A
git commit -m "feat: ..."
# الـ post-commit hook يُحدّث Graphify + Understand Anything تلقائياً
```

#### 3.3 حدّث Obsidian (يدوي — مهم!)

اسأل نفسك:
- **هل ظهرت مشكلة جديدة؟** → أضف لـ `[[Problem-Log]]`
- **هل اتخذت قرار مهم؟** → أضف لـ `[[Decisions]]`
- **هل تعلمت درس جديد؟** → أضف لـ `[[Lessons-Learned]]`
- **هل اكتشفت نمط جديد؟** → أضف لـ `[[Patterns-To-Follow]]`
- **هل ارتكبت خطأ يجب تجنبه؟** → أضف لـ `[[Mistakes-To-Avoid]]`
- **هل أضفت ميزة؟** → أضف لـ `[[Tasks]]` و `[[Future-Features]]`

استخدم السكريبت:
```bash
bash scripts/update-brain.sh "عنوان المهمة" "ما تم" "الدرس"
```

#### 3.4 Git Commit + Push

```bash
git add Pythagoras-Brain/
git commit -m "brain: update with new knowledge from [task name]"
git push
```

---

## 🔄 سيناريو عملي (مثال)

### السؤال: "أضف نظام مصادقة للطلاب"

#### مرحلة 1: قبل المهمة

1. **اقرأ Obsidian:**
   - `[[Mistakes-To-Avoid#خطأ 3: تغيير الـ DB بدون سبب قوي]]`
   - `[[Architecture-Decisions#Prisma + SQLite]]`
   - `[[Tasks]]` — هل سبق عمل auth؟

2. **Graphify:**
   ```bash
   graphify query "auth login"
   graphify explain "User"
   graphify path "AdminTopBar" "useAuth"
   ```

3. **Understand Anything:**
   - افتح الـ dashboard
   - ابحث عن `User` model
   - ابحث عن `/api/users`
   - افهم كيف يعمل الـ Prisma

#### مرحلة 2: أثناء التنفيذ

- استخدم `User` model الموجود في `prisma/schema.prisma`
- أنشئ `/api/auth/login` route
- أنشئ `/api/auth/logout` route
- استخدم `bcrypt` لكلمة المرور
- استخدم `jsonwebtoken` لـ JWT

#### مرحلة 3: بعد الانتهاء

1. **اختبر:**
   ```bash
   curl -X POST http://127.0.0.1:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@test.com","password":"123"}'
   ```

2. **حدّث Graphify:**
   ```bash
   git add -A
   git commit -m "feat: add auth system (login/logout)"
   # ← Graphify يُحدّث تلقائياً
   ```

3. **حدّث Obsidian:**
   - أضف لـ `[[Tasks]]`:
     ```
     ### M10: Auth System
     - [x] login endpoint
     - [x] logout endpoint
     - [x] JWT generation
     ```
   - أضف لـ `[[Decisions/Technology-Decisions]]`:
     ```
     ## JWT Authentication
     **القرار:** استخدام JWT بدلاً من sessions
     **السبب:** stateless، أسرع، يعمل مع PWA
     ```
   - أضف لـ `[[Lessons-Learned]]`:
     ```
     ## درس 11: استخدم httpOnly cookies للـ JWT
     **السياق:** تخزين JWT في localStorage
     **المشكلة:** XSS يمكنه سرقته
     **الدرس:** استخدم httpOnly cookies
     ```
   - أضف لـ `[[Mistakes-To-Avoid]]`:
     ```
     ## خطأ 16: تخزين JWT في localStorage
     **الخطأ:** ...
     **التصحيح:** استخدم httpOnly cookies
     ```

4. **Push:**
   ```bash
   git add Pythagoras-Brain/
   git commit -m "brain: document auth system"
   git push
   ```

---

## 📊 جدول المسؤوليات

| الخطوة | المسؤول | الأداة |
|--------|--------|------|
| قراءة الـ memory قبل المهمة | AI | Obsidian |
| البحث السريع عن الكود | AI | Graphify |
| فهم عميق للملفات | AI | Understand Anything |
| تنفيذ المهمة | AI | Code editor |
| اختبار | AI | curl, browser |
| تحديث الـ graphs | تلقائي | git hook |
| تحديث الـ memory | AI | Obsidian |
| مراجعة الـ memory | المستخدم | Obsidian |
| اقتراح تحسينات | المستخدم | Obsidian (تعليقات) |

---

## ⚠️ قواعد إلزامية

1. **لا تبدأ مهمة بدون قراءة `[[Mistakes-To-Avoid]]`**
2. **لا تنتهي مهمة بدون تحديث Obsidian** (إذا كانت هناك معرفة جديدة)
3. **لا تنشئ مكون جديد** قبل البحث في Graphify
4. **لا تكرر حل مشكلة** موجودة في `[[Problem-Log]]`
5. **لا تتخذ قرار** بدون توثيقه في `[[Decisions]]`

---

## 🔗 الروابط بين الأدوات

```
Obsidian                    Graphify                 Understand Anything
   │                           │                           │
   │  "كيف يعمل نظام X؟"        │                           │
   │ ──────────────────────►   │                           │
   │                           │  يحدد الملفات              │
   │                           │ ──────────────────────►   │
   │                           │                           │  يشرح كل ملف
   │                           │                           │ ────────────►
   │                           │                           │       AI
   │  AI يقرأ الشرح            │                           │
   │ ◄─────────────────────────────────────────────────────│
   │                           │                           │
   │  AI ينفذ المهمة           │                           │
   │ ──────────────────────►   │                           │
   │                           │  git commit → تحديث        │
   │                           │ ◄─────────────────────    │
   │                           │                           │
   │  AI يحدّث الـ memory      │                           │
   │ ◄─────────────────────    │                           │
```

---

## 📚 ملفات مرجعية

- [[Mistakes-To-Avoid]] — اقرأ أولاً دائماً
- [[Patterns-To-Follow]] — اتبع الأنماط
- [[Lessons-Learned]] — تعلّم من الماضي
- [[Problem-Log]] — حلول جاهزة
- [[Decisions]] — القرارات المعمارية
- [[PLUGINS]] — plugins Obsidian

---

## 🎯 الخلاصة

> **الهدف:** تحويل Pythagoras Platform إلى مشروع لديه ذاكرة طويلة المدى.
>
> **الوسيلة:** Obsidian (memory) + Graphify (structure) + Understand Anything (semantics).
>
> **الالتزام:** قراءة قبل، تحديث بعد — دائماً.

---

## الروابط

- [[README]]
- [[PLUGINS]]
- [[SETUP]]
- [[Product-Strategy]]
