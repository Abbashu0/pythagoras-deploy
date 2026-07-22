---
type: decision
category: technology
status: active
created: 2026-07-22
tags: [decisions, technology]
---

# قرارات تقنية

## Graphify

### القرار
استخدام Graphify كأداة أساسية لفهم الكود.

### التفاصيل
- **التثبيت:** `uv tool install graphifyy` (Python)
- **الـ graph:** `graphify-out/graph.json` (1426 nodes, 3219 edges)
- **التحديث:** تلقائي عبر git post-commit hook
- **النشر:** على GitHub Pages (`gh-pages` branch)

### الاستخدام
```bash
# قبل المهمة
graphify query "how does auth work?"
graphify explain "UserService"
graphify path "ComponentA" "ServiceB"

# بعد المهمة
git commit  # ← يُحدّث الـ graph تلقائياً
```

### لماذا Graphify؟
- سريع (tree-sitter AST، بدون LLM)
- مجاني (0 tokens)
- يدعم ~40 لغة

---

## Understand Anything

### القرار
استخدام Understand Anything كأداة دلالية لفهم الكود.

### التفاصيل
- **التثبيت:** `~/.understand-anything/repo/` (git clone + pnpm build)
- **الـ graph:** `.ua/knowledge-graph.json` (530 nodes مفلتر من 10115)
- **البناء:** `node scripts/understand/build-graph.mjs`
- **النشر:** على GitHub Pages (self-contained HTML)

### لماذا 530 nodes وليس 10115؟
[[Understand Anything Browser Crash]] — الـ graph الكامل كان يقتل المتصفح.

### الفلترة
- كل الـ files (256) — محتفظ بها
- كل الـ classes (65) — محتفظ بها
- أعلى 200 function بالاتصالات — محتفظ بها
- بقية الـ functions (9594) — محذوفة

### لماذا Understand Anything؟
- شروحات لكل node
- tour mode (جولة إرشادية)
- filter pills للـ layers
- right sidebar مع INFO/FILES tabs
- language lessons

---

## Obsidian

### القرار
استخدام Obsidian كـ Second Brain للمشروع.

### التفاصيل
- **الموقع:** `Pythagoras-Brain/` (في نفس repo)
- **المزامنة:** Git-based (push/pull)
- **التنسيق:** Markdown files مع YAML frontmatter
- **الروابط:** `[[wikilinks]]` بين الملفات

### الـ Workflow
1. **قبل المهمة:** اقرأ `AI-Memory/Mistakes-To-Avoid.md` + `Decisions/`
2. **أثناء المهمة:** استخدم Graphify + Understand Anything
3. **بعد المهمة:** حدّث Obsidian بالمعرفة الجديدة → `git commit` + `push`

### لماذا Obsidian؟
- ملفات Markdown بسيطة (لا lock-in)
- روابط بين المعرفة
- تطبيق محلي (لا cloud إلزامي)
- مجاني

---

## Caddy Reverse Proxy

### القرار
الـ preview URL يمر عبر Caddy proxy → `localhost:3000`.

### التفاصيل
- Caddy يعمل كـ PID 1 في الـ container
- الـ config في `/app/Caddyfile` (لا نستطيع تعديله)
- يدعم `XTransformPort` query param للوصول لأي port

### المشكلة
[[Container Process Killing]] — أي process خلفي يُقتل بعد 45-60 ثانية.

---

## Git Hooks

### القرار
استخدام git hooks لـ:
1. **post-commit:** تحديث Graphify + Understand Anything تلقائياً
2. **post-commit:** (مستقبلاً) تحديث Obsidian إذا تغير

### التنفيذ
الـ hook في `.git/hooks/post-commit`:
```bash
# Graphify (Python)
graphify . --code-only

# Understand Anything (Node)
node scripts/understand/build-graph.mjs
```

### ملاحظة
الـ graphs المحلية في `.gitignore` (لا تُpush لـ GitHub).

---

## Production Build (standalone)

### القرار
استخدام `output: "standalone"` في `next.config.ts`.

### التفاصيل
- `npm run build` يُنتج `.next/standalone/server.js`
- `node .next/standalone/server.js` يشغل الـ server
- لا يحتاج `node_modules` كامل
- أسرع من `npm run dev`

### المشكلة
[[Container Process Killing]] — الـ process يُقتل، نحتاج `setsid` للفصل.

---

## الروابط

- [[Architecture-Decisions]]
- [[UX-Decisions]]
- [[Lessons-Learned]]
