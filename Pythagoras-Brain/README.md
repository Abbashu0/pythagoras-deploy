# Pythagoras Brain — Second Brain للمشروع

هذا الـ vault هو **ذاكرة طويلة المدى** لمشروع Pythagoras Platform. يحفظ تاريخ التطوير، القرارات، المشاكل، الحلول، والمعرفة المكتسبة.

## 📁 الهيكل

```
Pythagoras-Brain/
├── Project-Overview/         ← رؤية وأهداف المشروع
│   ├── Vision.md
│   ├── Goals.md
│   └── Product-Strategy.md
├── Development-History/      ← سجل التطوير
│   ├── Tasks.md
│   ├── Milestones.md
│   └── Important-Changes.md
├── Decisions/                ← القرارات المعمارية والـ UX
│   ├── Architecture-Decisions.md
│   ├── UX-Decisions.md
│   └── Technology-Decisions.md
├── Problems-and-Solutions/   ← سجل المشاكل وحلولها
│   └── Problem-Log.md
├── AI-Memory/                ← ذاكرة الـ AI (مهم!)
│   ├── Lessons-Learned.md
│   ├── Patterns-To-Follow.md
│   └── Mistakes-To-Avoid.md
├── Roadmap/                  ← المستقبل
│   ├── Future-Features.md
│   └── Ideas.md
├── Templates/                ← قوالب لإنشاء ملاحظات جديدة
│   ├── task-template.md
│   ├── problem-template.md
│   ├── decision-template.md
│   └── lesson-template.md
├── README.md                 ← هذا الملف
├── SETUP.md                  ← دليل الإعداد على حاسوبك
├── PLUGINS.md                ← plugins الموصى بها
└── Workflow.md               ← الـ workflow المتكامل
```

## 🔗 الروابط (Wikilinks)

كل ملف يربط بملفات أخرى باستخدام `[[اسم الملف]]`. مثلاً:

- `[[Mistakes-To-Avoid]]` يربط لـ `AI-Memory/Mistakes-To-Avoid.md`
- `[[Architecture-Decisions]]` يربط لـ `Decisions/Architecture-Decisions.md`

في Obsidian، هذه الروابط تُصبح clickable وتظهر في الـ graph view.

## 📝 الـ Workflow

### قبل أي مهمة تطوير

1. اقرأ `[[Mistakes-To-Avoid]]` — لا تكرر أخطاء سابقة
2. اقرأ `[[Decisions]]` ذات الصلة — افهم السياق
3. استخدم Graphify لفهم الكود
4. ابدأ التنفيذ

### بعد كل مهمة مهمة

1. اختبر النتيجة
2. حدّث Graphify (تلقائي عبر git hook)
3. حدّث هذا الـ vault بالمعرفة الجديدة:
   - إذا كانت مشكلة جديدة → `[[Problem-Log]]`
   - إذا كان قرار جديد → `[[Decisions]]`
   - إذا كان درس جديد → `[[Lessons-Learned]]`
   - إذا كان نمط جديد → `[[Patterns-To-Follow]]`
   - إذا كان خطأ يجب تجنبه → `[[Mistakes-To-Avoid]]`
4. `git commit` + `git push`

## 🔄 المزامنة

هذا الـ vault في نفس repo المشروع (`pythagoras-deploy`). المزامنة عبر Git:

```bash
# للحصول على آخر تحديثاتي
git pull

# لإرسال تعديلاتك
git add Pythagoras-Brain/
git commit -m "update brain: ..."
git push
```

## 📖 كيف تقرأ هذا الـ vault

### في Obsidian (موصى به)
1. ثبّت Obsidian (مجاني من https://obsidian.md)
2. اتبع `[[SETUP]]` للإعداد
3. افتح `Pythagoras-Brain/` كـ vault
4. استكشف الـ graph view (Ctrl+G)

### في أي محرر Markdown
- VS Code, Typora, أو حتى Notepad
- لكن بدون روابط clickable أو graph view

### في GitHub
- تصفح مباشرة على https://github.com/Abbashu0/pythagoras-deploy/tree/main/Pythagoras-Brain

## 🎯 الهدف

> **تحويل Pythagoras Platform إلى مشروع لديه ذاكرة طويلة المدى يستطيع أي AI Engineer فهمه والعمل عليه حتى بعد مرور أشهر أو تغيير نموذج الذكاء الاصطناعي.**

## 📚 ابدأ من هنا

إذا كنت AI جديد يعمل على هذا المشروع:

1. اقرأ `[[Vision]]` أولاً
2. ثم `[[Mistakes-To-Avoid]]` (مهم جداً!)
3. ثم `[[Technology-Decisions]]`
4. ثم `[[Tasks]]` لمعرفة الحالة الحالية
5. ثم `[[Workflow]]` لفهم كيفية العمل

### للمستخدم (أنت)

1. اقرأ `[[SETUP]]` لتثبيت Obsidian على حاسوبك
2. اقرأ `[[PLUGINS]]` لتثبيت plugins الموصى بها
3. اقرأ `[[Workflow]]` لفهم الـ workflow المتكامل
4. استكشف الـ graph view (`Ctrl+G`)

---

## الروابط

- [[SETUP]] — دليل الإعداد على حاسوبك
- [[Vision]] — رؤية المشروع
- [[Mistakes-To-Avoid]] — اقرأ هذا أولاً!
