---
type: memory
category: lessons
status: active
created: 2026-07-22
tags: [memory, lessons]
---

# دروس تعلمناها

## درس 1: Production Build أفضل من Dev Mode

**السياق:** كنا نستخدم `npm run dev` للمعاينة.
**المشكلة:** استجابة بطيئة (2-6 ثوانٍ لكل صفحة)، compile عند الطلب.
**الدرس:** استخدم `npm run build` + `npm run start` دائماً للمعاينة.

**التطبيق:**
```bash
npm run build
node .next/standalone/server.js
```

---

## درس 2: لا تثقل الـ Container

**السياق:** حاولنا تشغيل Graphify + Understand Anything + Next.js في نفس الـ container.
**المشكلة:** الـ container يقتل العمليات الثقيلة.
**الدرس:** انقل العمليات الثقيلة لخدمات خارجية (GitHub Pages).

**التطبيق:**
- الـ graphs على GitHub Pages
- الـ server خفيف (Next.js فقط)

---

## درس 3: استخدم `setsid` للفصل

**السياق:** `nohup` + `&` لا يكفي لتشغيل process خلفي.
**المشكلة:** الـ process يُقتل عند انتهاء الـ shell.
**الدرس:** استخدم `setsid` لإنشاء session منفصل.

**التطبيق:**
```bash
setsid node .next/standalone/server.js > dev.log 2>&1 &
disown
```

---

## درس 4: تحقق من `.env` قبل التشغيل

**السياق:** `.env` يُمسح أحياناً.
**المشكلة:** `supabaseUrl is required` أو `DATABASE_URL` مفقود.
**الدرس:** تحقق دائماً من `.env` قبل تشغيل الـ server.

**التطبيق:**
```bash
grep -c "DATABASE_URL\|SUPABASE" .env
# يجب أن يعيد > 0
```

---

## درس 5: لا تعرض graphs كاملة في المتصفح

**السياق:** الـ Understand Anything dashboard كان 10,115 nodes.
**المشكلة:** المتصفح يتعطل (OOM).
**الدرس:** فلتر الـ graphs لـ < 1000 node للعرض في المتصفح.

**التطبيق:**
- احتفظ بكل الـ nodes في الـ JSON المحلي
- اعرض فقط أعلى N nodes في الـ UI

---

## درس 6: GitHub Pages للـ Static HTML

**السياق:** أردنا عرض graphs تفاعلية.
**المشكلة:** `raw.githubusercontent.com` يعرض HTML كـ text.
**الدرس:** فعّل GitHub Pages لخدمة HTML حقيقي.

**التطبيق:**
1. push لـ `gh-pages` branch
2. Settings → Pages → gh-pages
3. URL: `abbashu0.github.io/pythagoras-deploy/`

---

## درس 7: استخدم relative paths للـ static files

**السياق:** الـ dashboard JS يطلب `/knowledge-graph.json` من root.
**المشكلة:** على GitHub Pages، root مختلف → 404.
**الدرس:** استخدم relative paths أو embed الـ data.

**التطبيق:**
- `fetch("knowledge-graph.json")` بدلاً من `fetch("/knowledge-graph.json")`
- أو embed الـ data في الـ HTML (self-contained)

---

## درس 8: camelCase ↔ snake_case تلقائياً

**السياق:** عند استخدام DB مع snake_case (PostgreSQL) و TS مع camelCase.
**المشكلة:** تحويل يدوي لكل query = كود كثير وأخطاء.
**الدرس:** استخدم repository pattern مع تحويل تلقائي.

**التطبيق:**
- `BaseRepository` مع `toSnakeCase()` / `toCamelCase()`
- الـ entities تستخدم camelCase
- الـ DB يستخدم snake_case
- التحويل شفاف

---

## درس 9: لا تضع `<button>` داخل `<button>`

**السياق:** `QuestionList` كان زر خارجي يحتوي أزرار داخلية.
**المشكلة:** hydration error في React.
**الدرس:** استخدم `<div role="button">` للحاويات القابلة للنقر.

**التطبيق:**
```tsx
<div role="button" tabIndex={0} onClick={handleClick} onKeyDown={handleKeyDown}>
  <button onClick={handleInner}>زر داخلي</button>
</div>
```

---

## درس 10: الـ autosave daemon قد يقتل العمليات

**السياق:** بعد كل commit، الـ autosave daemon يُطلق graphify hook.
**المشكلة:** الـ hook يستهلك CPU ويقتل أحياناً الـ server.
**الدرس:** انتظر ثانيتين بعد كل commit.

**التطبيق:**
```bash
git commit -m "..."
sleep 2
# الآن شغّل الـ server
```

---

## الروابط

- [[Patterns-To-Follow]]
- [[Mistakes-To-Avoid]]
- [[Problem-Log]]
