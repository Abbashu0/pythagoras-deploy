---
type: memory
category: patterns
status: active
created: 2026-07-22
tags: [memory, patterns]
---

# أنماط يجب اتباعها

## نمط 1: Repository Pattern مع تحويل تلقائي

### الوصف
استخدام `BaseRepository<T>` مع تحويل camelCase ↔ snake_case تلقائياً.

### متى نستخدمه
عند التعامل مع DB (Prisma أو PostgreSQL أو أي SQL).

### التنفيذ
```typescript
// base-repository.ts
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter, idx) =>
    idx > 0 ? "_" + letter.toLowerCase() : letter.toLowerCase()
  );
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

class BaseRepository<T> {
  async create(data: Partial<T>): Promise<T> {
    const snakeRecord = transformToSnake(data);
    // ... insert
  }
}
```

### الفائدة
- الـ entities TS تستخدم camelCase (طبيعي)
- الـ DB يستخدم snake_case (convention)
- لا حاجة لتحويل يدوي في كل query

---

## نمط 2: Production Build للمعاينة

### الوصف
استخدام `npm run build` + `npm run start` بدلاً من `npm run dev`.

### متى نستخدمه
دائماً للمعاينة (إلا أثناء التطوير النشط).

### التنفيذ
```bash
npm run build
node .next/standalone/server.js
```

### الفائدة
- استجابة فورية (11ms)
- استقرار أكبر
- لا compile عند الطلب

---

## نمط 3: Static HTML على GitHub Pages

### الوصف
ملفات HTML ثقيلة (graphs, dashboards) تُخدم من GitHub Pages.

### متى نستخدمه
عندما يكون الملف > 1MB أو يحتاج JS ثقيل.

### التنفيذ
1. ضع الملفات في branch منفصل (`gh-pages`)
2. فعّل GitHub Pages (Settings → Pages → gh-pages)
3. استخدم relative paths في الـ HTML
4. أو embed الـ data (self-contained HTML)

### الفائدة
- لا عبء على الـ container
- CDN سريع
- متاح دائماً

---

## نمط 4: `setsid` للفصل

### الوصف
استخدام `setsid` لتشغيل processes خلفية.

### متى نستخدمه
عند تشغيل server أو process طويل الأمد.

### التنفيذ
```bash
setsid node .next/standalone/server.js > dev.log 2>&1 &
disown
```

### الفائدة
- الـ process يبقى حياً بعد انتهاء الـ shell
- لا يتأثر بإشارات الـ shell

---

## نمط 5: git post-commit hooks للـ Graphs

### الوصف
تحديث الـ graphs تلقائياً بعد كل commit.

### متى نستخدمه
دائماً (مُفعّل حالياً).

### التنفيذ
```bash
# .git/hooks/post-commit
graphify . --code-only  # Graphify
node scripts/understand/build-graph.mjs  # Understand Anything
```

### الفائدة
- الـ graphs تبقى محدّثة دائماً
- لا نسيان

---

## نمط 6: توثيق القرارات

### الوصف
كتابة كل قرار مهم في `Decisions/`.

### متى نستخدمه
عند اتخاذ قرار architecture أو UX أو technology.

### التنفيذ
أضف قسم في `Decisions/Architecture-Decisions.md` (أو UX أو Technology):
```markdown
## عنوان القرار
**القرار:** ...
**السبب:** ...
**البديل الذي رفضناه:** ...
```

### الفائدة
- لا ننسى لماذا اتخذنا القرار
- AI المستقبلي يفهم السياق

---

## نمط 7: قبل كل مهمة

### الوصف
مراجعة الـ memory قبل البدء.

### متى نستخدمه
قبل أي مهمة تطوير.

### التنفيذ
1. اقرأ `[[Mistakes-To-Avoid]]`
2. اقرأ `[[Decisions]]` ذات الصلة
3. استخدم Graphify لفهم الكود
4. ابدأ التنفيذ

### الفائدة
- لا تكرار للأخطاء
- فهم السياق السابق

---

## نمط 8: بعد كل مهمة

### الوصف
تحديث الـ memory بعد الانتهاء.

### متى نستخدمه
بعد كل مهمة تطوير مهمة.

### التنفيذ
1. اختبر
2. حدّث Graphify (تلقائي عبر hook)
3. حدّث Obsidian بالمعرفة الجديدة
4. `git commit` + `push`

### الفائدة
- الـ memory تبقى محدّثة
- AI المستقبلي يرى آخر التطورات

---

## نمط 9: relative paths في static files

### الوصف
استخدام `assets/index.js` بدلاً من `/assets/index.js`.

### متى نستخدمه
عند بناء HTML ثابت للنشر على subpath.

### التنفيذ
```bash
sed -i 's|src="/assets/|src="assets/|g' index.html
```

### الفائدة
- يعمل على أي subpath
- لا مشاكل مع GitHub Pages

---

## نمط 10: README في كل مجلد

### الوصف
كل مجلد رئيسي فيه README.md يشرح محتواه.

### متى نستخدمه
للمجلدات الكبيرة.

### الفائدة
- فهم سريع للمحتوى
- تنظيم واضح

---

## الروابط

- [[Lessons-Learned]]
- [[Mistakes-To-Avoid]]
- [[Product-Strategy]]
