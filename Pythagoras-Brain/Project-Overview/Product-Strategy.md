---
type: strategy
status: active
created: 2026-07-22
tags: [core, strategy]
---

# استراتيجية المنتج

## البنية المعمارية الحالية

```
┌─────────────────────────────────────────────────────────────┐
│                      Pythagoras Platform                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐        ┌─────────────────┐            │
│  │   تطبيق الطالب   │        │   لوحة الأدمن    │            │
│  │  (Vanilla JS)   │        │  (Next.js 16)   │            │
│  │  public/pythagoras/      │  src/            │            │
│  └────────┬────────┘        └────────┬────────┘            │
│           │                          │                      │
│           └──────────┬───────────────┘                      │
│                      │                                       │
│              ┌───────▼────────┐                              │
│              │   API Routes   │                              │
│              │  /api/*        │                              │
│              └───────┬────────┘                              │
│                      │                                       │
│              ┌───────▼────────┐                              │
│              │    Prisma ORM   │                              │
│              │   + SQLite     │                              │
│              └────────────────┘                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## التقنيات المستخدمة

| المكوّن | التقنية | السبب |
|---------|------|------|
| **لوحة الأدمن** | Next.js 16 + Turbopack | سريع، React Server Components |
| **UI Framework** | shadcn/ui + Tailwind CSS | مكونات جميلة وقابلة للتخصيص |
| **تطبيق الطالب** | Vanilla JS SPA | خفيف جداً، لا build step |
| **قاعدة البيانات** | Prisma + SQLite | بسيط، ملف واحد، لا server منفصل |
| **Graphs** | Graphify + Understand Anything | فهم الكود (على GitHub Pages) |
| **الذاكرة** | Obsidian vault (Git-synced) | ذاكرة طويلة المدى للمشروع |

## استراتيجية التطوير

### 1. Production Build أولاً
- لا نستخدم `npm run dev` للمعاينة
- نستخدم `npm run build` + `npm run start`
- السبب: [[Container Process Killing]]

### 2. Graphs على GitHub Pages
- لا نخدم الـ graphs من الـ container (تقتله)
- GitHub Pages مستقل وسريع
- الـ graphs المحلية في `graphify-out/` و `.ua/` للاستخدام الداخلي فقط

### 3. Git-Based Workflow
- كل شيء في GitHub repo
- Obsidian vault في نفس الـ repo
- المزامنة عبر `git push` / `git pull`

## استراتيجية النشر (المستقبلية)

| المرحلة | المنصة | السبب |
|---------|--------|------|
| **التطوير** | Container (هنا) | للكود والاختبار |
| **المعاينة** | Preview URL | للعرض المؤقت |
| **الإنتاج** | Vercel أو VPS | للنشر النهائي |
| **الـ Graphs** | GitHub Pages | دائماً مستقل |

## الهدف من الـ Second Brain

```
قبل كل مهمة:
  1. اقرأ [[Mistakes-To-Avoid]]
  2. اقرأ [[Decisions]] ذات الصلة
  3. استخدم Graphify لفهم الكود
  4. ابدأ التنفيذ

بعد كل مهمة:
  1. اختبر
  2. حدّث Graphify (تلقائي عبر git hook)
  3. حدّث Obsidian بالمعرفة الجديدة
  4. git commit + push
```

## الروابط

- [[Vision]]
- [[Goals]]
- [[Architecture-Decisions]]
