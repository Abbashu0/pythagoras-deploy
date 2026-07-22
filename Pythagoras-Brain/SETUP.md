# إعداد Pythagoras Brain على حاسوبك (Windows)

هذا الدليل يشرح كيف تفتح الـ vault على حاسوبك وترى كل الملاحظات والروابط.

## 📦 الخطوة 1: تثبيت Obsidian

1. اذهب لـ https://obsidian.md
2. حمّل نسخة Windows
3. ثبّت البرنامج (مجاني تماماً)

## 📥 الخطوة 2: استنساخ الـ repo

### الطريقة الأولى: GitHub Desktop (أسهل)

1. ثبّت GitHub Desktop من https://desktop.github.com
2. سجّل دخولك بحساب GitHub
3. اضغط `File` → `Clone repository`
4. اختر `Abbashu0/pythagoras-deploy`
5. اختر مكان الحفظ (مثلاً `C:\Users\YourName\Documents\pythagoras-deploy`)

### الطريقة الثانية: Git CLI

```powershell
# افتح PowerShell أو Command Prompt
cd C:\Users\YourName\Documents
git clone https://github.com/Abbashu0/pythagoras-deploy.git
```

## 📂 الخطوة 3: فتح الـ vault في Obsidian

1. افتح Obsidian
2. اضغط **"Open folder as vault"**
3. اختر مجلد `Pythagoras-Brain` داخل الـ repo:
   ```
   C:\Users\YourName\Documents\pythagoras-deploy\Pythagoras-Brain
   ```
4. سيفتح الـ vault وترى كل الملفات

## 🔍 الخطوة 4: استكشاف الـ vault

### القراءة
- اضغط على أي ملف في الـ sidebar الأيسر
- أو استخدم `Ctrl+P` واكتب اسم الملف

### الروابط (Wikilinks)
- أي نص بين `[[` و `]]` هو رابط clickable
- اضغط عليه للانتقال للملف
- `Ctrl+Click` يفتحه في tab جديد

### Graph View
- اضغط `Ctrl+G` لرؤية الـ graph
- ستظهر كل الملفات كـ nodes والروابط كـ edges
- جميل جداً للفهم البصري

### البحث
- `Ctrl+Shift+F` للبحث في كل الـ vault

## 🔄 الخطوة 5: المزامنة

### للحصول على آخر تحديثاتي

**بـ GitHub Desktop:**
1. افتح GitHub Desktop
2. اضغط **"Fetch origin"**
3. اضغط **"Pull origin"**

**بـ Git CLI:**
```powershell
cd C:\Users\YourName\Documents\pythagoras-deploy
git pull
```

### لإرسال تعديلاتك (إذا أضفت ملاحظات)

**بـ GitHub Desktop:**
1. اكتب رسالة commit في الـ field السفلي
2. اضغط **"Commit to main"**
3. اضغط **"Push origin"**

**بـ Git CLI:**
```powershell
cd C:\Users\YourName\Documents\pythagoras-deploy
git add Pythagoras-Brain/
git commit -m "update brain: ..."
git push
```

## 📱 المزامنة مع iPhone

### الطريقة: Working Copy (مدفوع مرة واحدة ~$25)

1. ثبّت Working Copy من App Store
2. أضف الـ repo: `Abbushu0/pythagoras-deploy`
3. Pull للحصول على التحديثات
4. افتح Obsidian على iPhone
5. افتح مجلد `Pythagoras-Brain` من Working Copy

### الطريقة البديلة: GitHub Web (مجاني لكن للقراءة فقط)

1. افتح Safari على iPhone
2. اذهب لـ https://github.com/Abbashu0/pythagoras-deploy/tree/main/Pythagoras-Brain
3. تصفح الملفات (بدون Obsidian features)

## ⚙️ إعدادات Obsidian الموصى بها

### الإعدادات الأساسية
1. `Settings` → `Editor`
   - **Default view for new tabs:** Editing view
   - **Strict line breaks:** On

2. `Settings` → `Files & Links`
   - **Default location for new notes:** Same folder as current file
   - **New link format:** Shortest path when possible

### Plugins مدمجة (فعّلها)
1. `Settings` → `Core plugins`
   - ✅ **Graph view**
   - ✅ **Backlinks**
   - ✅ **Outgoing links**
   - ✅ **Tag pane**
   - ✅ **Daily notes** (اختياري)

### Plugins مجتمعية (بعد تثبيت Community Plugins)
- **Calendar** — عرض تقويمي للملاحظات
- **Kanban** — لوحات Kanban للمهام
- **Dataview** — استعلامات على الملاحظات

## 🎨 تخصيص المظهر

### Theme
- `Settings` → `Appearance` → `Themes`
- جرب **"Minimal"** أو **"Atom"**

### Font
- `Settings` → `Appearance` → `Font`
- للعربية: **"Cairo"** أو **"Noto Sans Arabic"**

## ❓ مشاكل شائعة

### "Vault is already open in another window"
- أغلق كل نوافذ Obsidian
- أعد فتح الـ vault

### "File not found" عند الضغط على رابط
- تأكد أنك فتحت `Pythagoras-Brain/` وليس الـ repo كله
- الروابط تعمل فقط داخل الـ vault

### أحرف عربية تظهر بشكل خاطئ
- `Settings` → `Appearance` → `Font` → اختر خط يدعم العربية

## 📞 الدعم

إذا واجهت مشكلة:
1. تحقق من [[README]]
2. اسأل في الـ chat

---

## روابط مفيدة

- [[README]]
- [[Vision]]
- [[Mistakes-To-Avoid]]
