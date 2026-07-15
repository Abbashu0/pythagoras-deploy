export const themeLabels = { dark: "داكن", light: "فاتح", aurora: "شفق" };

export const densityLabels = {
  compact: "صغير",
  comfortable: "قياسي",
  spacious: "كبير",
};

export const tools = [
  {
    id: "spaced",
    title: "التكرار المتباعد",
    status: "قريبًا",
    statusClass: "is-soon",
    hint: "سيتفعّل لاحقًا",
    icon: "repeat",
    description: "خطة مراجعة ذكية تساعد الطالب على توزيع المراجعات حسب معدل النسيان والضغط الدراسي.",
  },
  {
    id: "pomodoro",
    title: "بومودورو",
    status: "قريبًا",
    statusClass: "is-soon",
    hint: "قيد الإعداد",
    icon: "timer",
    description: "جلسات تركيز قصيرة بتوقيت هادئ تساعد الطالب على الاستمرار بدون إرهاق.",
  },
  {
    id: "notebook",
    title: "دفتري",
    status: "قريبًا",
    statusClass: "is-soon",
    hint: "ضمن نفس الهوية",
    icon: "notebook",
    description: "مساحة لحفظ الملاحظات السريعة والملخصات وربطها بالدراسة.",
  },
  {
    id: "assistants",
    title: "المساعدون الأذكياء",
    status: "قريبًا",
    statusClass: "is-soon",
    hint: "شرح موجّه حسب المادة",
    icon: "brain",
    description: "مساعدون موجّهون حسب المادة لشرح المفاهيم والإجابة من مصادر موثوقة.",
  },
  {
    id: "lectures",
    title: "المحاضرات",
    status: "قريبًا",
    statusClass: "is-soon",
    hint: "مواد وروابط مرتبة",
    icon: "lectures",
    description: "تنظيم المحاضرات والروابط والمواد التعليمية داخل كل مادة.",
  },
];

export const navItems = [
  { id: "home", label: "الرئيسية", icon: "home" },
  { id: "materials", label: "المواد", icon: "book" },
  { id: "tools", label: "الأدوات", icon: "toolbox" },
  { id: "lectures", label: "المحاضرات", icon: "play" },
  { id: "settings", label: "الإعدادات", icon: "settings" },
];

export const viewNavMap = {
  home: "home",
  materials: "materials",
  tools: "tools",
  lectures: "lectures",
  settings: "settings",
  tests: "materials",
};

export const screens = {
  tools: {
    title: "الأدوات",
    eyebrow: "Pythagoras Tools",
    stateLabel: "المرحلة الأولى",
    copy: "مركز أدواتك الدراسية. ابدأ بالاختبارات، وستصل بقية الأدوات تدريجيًا بنفس التجربة.",
  },
  home: {
    title: "الرئيسية",
    eyebrow: "Home",
    stateLabel: "نقطة البداية",
    copy: "نظرة سريعة على يومك الدراسي — الاختبارات القادمة، آخر المهام، وتقدمك الأسبوعي.",
    icon: "home",
  },
  tasks: {
    title: "المهام",
    eyebrow: "Tasks",
    stateLabel: "قيد البناء",
    copy: "سنضيف هنا لاحقًا متابعة يومية واضحة للواجبات والخطوات الدراسية.",
    icon: "tasks",
  },
  notes: {
    title: "الملاحظات",
    eyebrow: "Notes",
    stateLabel: "قيد البناء",
    copy: "ستتحول هذه الصفحة لاحقًا إلى مساحة تدوين منظمة ومتصلة ببقية الأدوات.",
    icon: "notes",
  },
  settings: {
    title: "الإعدادات",
    eyebrow: "Settings",
    stateLabel: "قابل للتخصيص",
    copy: "اضبط مظهر التطبيق. ستُضاف بقية الإعدادات لاحقًا ضمن نفس الهوية.",
    icon: "settings",
  },
  materials: {
    title: "المواد",
    eyebrow: "Materials",
    stateLabel: "كل المواد",
    copy: "تصفح جميع المواد الدراسية واختر المادة للوصول إلى الاختبارات والأسئلة.",
    icon: "book",
  },
  lectures: {
    title: "المحاضرات",
    eyebrow: "Lectures",
    stateLabel: "قريباً",
    copy: "ستتوفر المحاضرات والفيديوهات التعليمية قريباً.",
    icon: "play",
  },
  tests: {
    title: "الاختبارات",
    eyebrow: "Tests",
    stateLabel: "اختيار المادة",
    copy: "اختر المادة التي تريد التدريب عليها. سنبدأ بتنظيم الاختبارات حسب المادة ثم نضيف تفاصيل الاختبار تدريجيًا.",
    icon: "tests",
  },
};

export const testSubjects = [
  {
    id: "biology",
    title: "الأحياء",
    icon: "biology",
    description: "اختبارات وأسئلة مادة الأحياء للسادس العلمي.",
    pageDescription: "أنشئ اختبارًا مخصصًا أو افتح بنك الأسئلة الخاص بهذه المادة.",
    stateLabel: "قيد التجهيز",
    hasDiagramPractice: true,
  },
  {
    id: "chemistry",
    title: "الكيمياء",
    icon: "chemistry",
    description: "مسار اختبارات الكيمياء سيُبنى بنفس نظام فيثاغورس.",
    pageDescription: "أنشئ اختبارًا مخصصًا أو افتح بنك الأسئلة الخاص بهذه المادة.",
    stateLabel: "قيد التجهيز",
    hasDiagramPractice: false,
  },
  {
    id: "physics",
    title: "الفيزياء",
    icon: "physics",
    description: "اختبارات الفيزياء ستكون منظمة حسب الفصول والموضوعات لاحقًا.",
    pageDescription: "أنشئ اختبارًا مخصصًا أو افتح بنك الأسئلة الخاص بهذه المادة.",
    stateLabel: "قيد التجهيز",
    hasDiagramPractice: false,
  },
  {
    id: "math",
    title: "الرياضيات",
    icon: "math",
    description: "مسار تدريبي للمسائل والاختبارات الرياضية لاحقًا.",
    pageDescription: "أنشئ اختبارًا مخصصًا أو افتح بنك الأسئلة الخاص بهذه المادة.",
    stateLabel: "قيد التجهيز",
    hasDiagramPractice: false,
  },
  {
    id: "arabic",
    title: "اللغة العربية",
    icon: "arabic",
    description: "اختبارات اللغة العربية ستُضاف ضمن نفس تجربة الاختبارات.",
    pageDescription: "أنشئ اختبارًا مخصصًا أو افتح بنك الأسئلة الخاص بهذه المادة.",
    stateLabel: "قيد التجهيز",
    hasDiagramPractice: false,
  },
  {
    id: "english",
    title: "اللغة الإنكليزية",
    icon: "english",
    description: "اختبارات اللغة الإنكليزية ستُبنى لاحقًا بطريقة منظمة.",
    pageDescription: "أنشئ اختبارًا مخصصًا أو افتح بنك الأسئلة الخاص بهذه المادة.",
    stateLabel: "قيد التجهيز",
    hasDiagramPractice: false,
  },
  {
    id: "islamic",
    title: "التربية الإسلامية",
    icon: "islamic",
    description: "اختبارات التربية الإسلامية ستُضاف لاحقًا ضمن المنصة.",
    pageDescription: "أنشئ اختبارًا مخصصًا أو افتح بنك الأسئلة الخاص بهذه المادة.",
    stateLabel: "قيد التجهيز",
    hasDiagramPractice: false,
  },
  {
    id: "french",
    name: "اللغة الفرنسية",
    title: "اللغة الفرنسية",
    icon: "french",
    description: "اختبارات اللغة الفرنسية ستُضاف لاحقًا ضمن نفس تجربة الاختبارات.",
    pageDescription: "أنشئ اختبارًا مخصصًا أو افتح بنك الأسئلة الخاص بهذه المادة.",
    stateLabel: "قيد التجهيز",
    available: false,
    color: "#3b82f6",
    hasDiagramPractice: false,
  },
];

export function getTestsSubjectView(subjectId) {
  return `tests-${subjectId}`;
}

export function getQuestionBankView(subjectId) {
  return `question-bank-${subjectId}`;
}

export function getBiologyQuestionDetailView(globalOrder) {
  return `biology-question-${globalOrder}`;
}

export function getSubjectById(subjectId) {
  return testSubjects.find((subject) => subject.id === subjectId) || null;
}

export function getSubjectByView(view) {
  if (!view || !view.startsWith("tests-")) {
    return null;
  }

  return getSubjectById(view.slice(6));
}

export function getQuestionBankSubjectByView(view) {
  if (!view || !view.startsWith("question-bank-")) {
    return null;
  }

  return getSubjectById(view.slice(14));
}

export function getBiologyQuestionDetailFromView(view) {
  const match = /^biology-question-(\d+)$/.exec(view || "");
  return match ? Number(match[1]) : null;
}

export function getViewMeta(view) {
  const subject = getSubjectByView(view);
  if (subject) {
    return {
      title: `اختبارات ${subject.title}`,
      eyebrow: "Subject Tests",
      stateLabel: "مسارات المادة",
      copy: subject.pageDescription,
      icon: subject.icon,
    };
  }

  const questionBankSubject = getQuestionBankSubjectByView(view);
  if (questionBankSubject) {
    return {
      title: `بنك أسئلة ${questionBankSubject.title}`,
      eyebrow: "Question Bank",
      stateLabel: "تصفح المادة",
      copy: `ستظهر هنا أسئلة ${questionBankSubject.title} بعد ربط بنك الأسئلة. يمكنك لاحقًا البحث والتصفح حسب الفصل والنوع.`,
      icon: questionBankSubject.icon,
    };
  }

  const biologyQuestionGlobal = getBiologyQuestionDetailFromView(view);
  if (biologyQuestionGlobal !== null) {
    return {
      title: `سؤال #${biologyQuestionGlobal}`,
      eyebrow: "بنك أسئلة الأحياء",
      stateLabel: "تفاصيل السؤال",
      copy: "تفاصيل السؤال وإجابته من بنك أسئلة الأحياء.",
      icon: "tests",
    };
  }

  return screens[view] || screens.tools;
}

testSubjects.forEach((subject) => {
  viewNavMap[getTestsSubjectView(subject.id)] = "materials";
  viewNavMap[getQuestionBankView(subject.id)] = "materials";
});

/**
 * SponsoredBanner model.
 *
 * Each banner represents a single slide in the SponsoredCarouselCard on the Home page.
 *
 * Fields:
 * - id:           stable unique identifier (used as React-like key + logged on tap)
 * - image:        CSS background value (gradient or url) for the slide's left visual panel
 * - iconKey:      icon key from icons.js — used as the focal glyph inside the visual panel
 * - title:        headline shown on the right panel (e.g. "مراجعة الأحياء")
 * - subtitle:     supporting line under the title
 * - destination:  route or URL the banner should navigate to (not wired yet — taps only log id)
 * - enabled:      when false, the banner is filtered out before render
 * - displayOrder: integer controlling sort order (1 = first)
 *
 * Today these 5 objects are local. Tomorrow they will arrive from an Admin Panel
 * with the exact same shape — the SponsoredCarouselCard widget will not need to change.
 */
export const SponsoredBanner = {
  fields: ["id", "image", "iconKey", "title", "subtitle", "destination", "enabled", "displayOrder"],
};

export const sponsoredBanners = [
  {
    id: "bio-review",
    bannerType: "split",
    iconKey: "biology",
    image: "linear-gradient(135deg, oklch(58% 0.13 145), oklch(48% 0.10 165))",
    gradient: "linear-gradient(135deg, oklch(58% 0.13 145), oklch(48% 0.10 165))",
    title: "مراجعة الأحياء",
    subtitle: "ملخص شامل للفصول الأربعة مع نماذج وزارية",
    destination: "tests-biology",
    enabled: true,
    displayOrder: 1,
    transform: { offsetX: 0, offsetY: 0, scale: 1 },
  },
  {
    id: "math-course",
    bannerType: "split",
    iconKey: "math",
    image: "linear-gradient(135deg, oklch(60% 0.16 25), oklch(50% 0.18 15))",
    gradient: "linear-gradient(135deg, oklch(60% 0.16 25), oklch(50% 0.18 15))",
    title: "دورة الرياضيات",
    subtitle: "تفاضل وتكامل شرح كامل بمستوى السادس علمي",
    destination: "tests-math",
    enabled: true,
    displayOrder: 2,
    transform: { offsetX: 0, offsetY: 0, scale: 1 },
  },
  {
    id: "chemistry-course",
    bannerType: "split",
    iconKey: "chemistry",
    image: "linear-gradient(135deg, oklch(62% 0.14 280), oklch(52% 0.16 270))",
    gradient: "linear-gradient(135deg, oklch(62% 0.14 280), oklch(52% 0.16 270))",
    title: "كورس الكيمياء",
    subtitle: "التفاعلات والحسابات الكيميائية بأسلوب مبسّط",
    destination: "tests-chemistry",
    enabled: true,
    displayOrder: 3,
    transform: { offsetX: 0, offsetY: 0, scale: 1 },
  },
  {
    id: "physics-course",
    bannerType: "split",
    iconKey: "physics",
    image: "linear-gradient(135deg, oklch(60% 0.14 220), oklch(50% 0.16 240))",
    gradient: "linear-gradient(135deg, oklch(60% 0.14 220), oklch(50% 0.16 240))",
    title: "دورة الفيزياء",
    subtitle: "الميكانيك والكهرباء بحلول مسائل خطوة بخطوة",
    destination: "tests-physics",
    enabled: true,
    displayOrder: 4,
    transform: { offsetX: 0, offsetY: 0, scale: 1 },
  },
  {
    id: "teacher-course",
    bannerType: "split",
    iconKey: "lectures",
    image: "linear-gradient(135deg, oklch(60% 0.18 350), oklch(50% 0.16 340))",
    gradient: "linear-gradient(135deg, oklch(60% 0.18 350), oklch(50% 0.16 340))",
    title: "كورس المعلم",
    subtitle: "جلسات مكثفة مع نخبة من المعلمين قبل الامتحان",
    destination: "tests",
    enabled: true,
    displayOrder: 5,
    transform: { offsetX: 0, offsetY: 0, scale: 1 },
  },
];

/**
 * Admin store key — MUST stay in sync with src/lib/admin/admin-store.ts.
 * The student app reads what the admin dashboard writes, so they share
 * the exact same localStorage key.
 */
const ADMIN_BANNERS_KEY = "pythagoras-admin-banners";

/**
 * Returns the live list of sponsored banners.
 *
 * Priority:
 *   1. Banners saved by the Admin Dashboard (localStorage `pythagoras-admin-banners`).
 *      Only enabled banners are returned, sorted by displayOrder.
 *   2. If localStorage is empty (first visit, never opened admin), fall back to
 *      the hard-coded `sponsoredBanners` seed above so the Home page is never blank.
 *
 * When the backend arrives, this function will fetch from the API instead of
 * localStorage — the SponsoredCarouselCard widget won't change.
 *
 * Also normalizes the banner shape so the student app handles both the admin's
 * full SponsoredBanner (with `image`, `gradient`, `transform`) and the simpler
 * seed shape (where `image` holds the gradient string).
 */
export function getSponsoredBanners() {
  try {
    const raw = localStorage.getItem(ADMIN_BANNERS_KEY);
    if (!raw) return sponsoredBanners.slice();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return sponsoredBanners.slice();
    // Filter enabled + active (not archived), sort by displayOrder, normalize shape
    return parsed
      .filter((b) => b && b.enabled !== false && b.status !== "archived")
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .map((b) => ({
        id: b.id,
        // Pass bannerType through so the carousel renderer can switch layout.
        // Default to "split" for older banners that don't have the field.
        bannerType: b.bannerType || "split",
        iconKey: b.iconKey || "tests",
        // Image: if banner has an imageKey, look it up in IndexedDB
        // (the admin stores image data there, NOT in localStorage). Falls
        // back to the inline `image` field (legacy) or the gradient.
        image:
          (b.imageKey && window.ImageDB && window.ImageDB.getImageSync(b.imageKey)) ||
          (b.image && b.image.length > 0
            ? b.image
            : b.gradient || "linear-gradient(135deg, #4f9cff, #2a6fcc)"),
        gradient: b.gradient || b.image,
        title: b.title || "",
        subtitle: b.subtitle || "",
        destination: b.destination || "tests",
        enabled: b.enabled !== false,
        displayOrder: b.displayOrder || 1,
        transform: b.transform || { offsetX: 0, offsetY: 0, scale: 1 },
      }));
  } catch {
    return sponsoredBanners.slice();
  }
}

// ============================================
// Live getters — read from admin localStorage
// with fallback to hardcoded defaults.
// Same pattern as getSponsoredBanners().
// ============================================

const ADMIN_NAV_KEY = "pythagoras-admin-nav-items";
const ADMIN_MATERIALS_KEY = "pythagoras-admin-materials";
const ADMIN_TOOLS_KEY = "pythagoras-admin-tools";

/**
 * Returns the live nav items from the admin store.
 * Falls back to the hardcoded navItems if localStorage is empty.
 * The admin Navigation Manager writes to this key.
 */
export function getNavItems() {
  try {
    const raw = localStorage.getItem(ADMIN_NAV_KEY);
    if (!raw) return navItems.slice();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return navItems.slice();
    return parsed
      .filter((item) => item && item.enabled !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((item) => ({
        id: item.id,
        label: item.label || "",
        icon: item.icon || "home",
      }));
  } catch {
    return navItems.slice();
  }
}

/**
 * Hardcoded English titles for each subject id.
 *
 * The admin Materials Manager can override these per-item via the
 * `englishTitle` field. We keep this map as a fallback so the student
 * app still shows a sensible English caption when the admin store
 * hasn't set one yet (e.g. first visit, fresh install, or older
 * localStorage data that predates the englishTitle field).
 */
const ENGLISH_TITLES = {
  islamic: "ISLAMIC",
  arabic: "ARABIC",
  english: "ENGLISH",
  biology: "BIOLOGY",
  math: "MATHEMATICS",
  chemistry: "CHEMISTRY",
  physics: "PHYSICS",
  french: "FRENCH",
};

/** Default gradient backgrounds for subjects without uploaded images. */
const SUBJECT_GRADIENTS = {
  islamic: "linear-gradient(135deg, #1a5c3a, #0d3a24)",
  arabic: "linear-gradient(135deg, #8b4513, #5c2e0a)",
  english: "linear-gradient(135deg, #1e3a8a, #0f1e4a)",
  biology: "linear-gradient(135deg, #166534, #0a3d20)",
  math: "linear-gradient(135deg, #7c2d12, #4a1a08)",
  chemistry: "linear-gradient(135deg, #581c87, #2e0a4a)",
  physics: "linear-gradient(135deg, #0c4a6e, #062840)",
  french: "linear-gradient(135deg, #1e40af, #0a1e5a)",
};

/**
 * Separate localStorage key for the global materials fade intensity.
 * MUST stay in sync with `src/lib/admin/content-store.ts` — that file
 * derives the fade key as `${storageKey}-fade`, where the materials
 * storageKey is `pythagoras-admin-materials`.
 *
 * Stored as a decimal string (e.g. "0.72") — the student app reads it
 * directly as the alpha value of the bottom-up black gradient overlay
 * on each material card.
 */
const ADMIN_MATERIALS_FADE_KEY = "pythagoras-admin-materials-fade";
const ADMIN_MATERIALS_SETTINGS_KEY = "pythagoras-admin-materials-settings";

/**
 * Returns the global fade intensity for material cards (0–1).
 * Defaults to 0.72.
 */
export function getMaterialsFadeIntensity() {
  try {
    const raw = localStorage.getItem(ADMIN_MATERIALS_FADE_KEY);
    if (raw === null) return 0.72;
    const val = Number.parseFloat(raw);
    if (!Number.isFinite(val) || val < 0 || val > 1) return 0.72;
    return val;
  } catch {
    return 0.72;
  }
}

/**
 * Returns all global material card appearance settings from the admin store.
 *
 * Settings are stored in a single JSON object in localStorage under
 * `pythagoras-admin-materials-settings`. Each field has a sensible default
 * so the student app works even if the admin has never been opened.
 *
 * Fields:
 *   - fadeIntensity:        0–1, default 0.72. Bottom black gradient alpha.
 *   - textVerticalPosition: -100 to +100, default 0. Vertical text offset.
 *   - textScale:            0.8–1.4, default 1. Global text size multiplier.
 *   - cardHeight:           160–340, default 213. Card height in pixels.
 */
export function getMaterialsSettings() {
  const defaults = {
    fadeIntensity: 0.72,
    textVerticalPosition: 0,
    textScale: 1,
    cardHeight: 213,
  };
  try {
    const raw = localStorage.getItem(ADMIN_MATERIALS_SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      fadeIntensity: typeof parsed.fadeIntensity === "number" ? parsed.fadeIntensity : defaults.fadeIntensity,
      textVerticalPosition: typeof parsed.textVerticalPosition === "number" ? parsed.textVerticalPosition : defaults.textVerticalPosition,
      textScale: typeof parsed.textScale === "number" ? parsed.textScale : defaults.textScale,
      cardHeight: typeof parsed.cardHeight === "number" ? parsed.cardHeight : defaults.cardHeight,
    };
  } catch {
    return defaults;
  }
}

/**
 * Returns the live test subjects (materials) from the admin store.
 * Falls back to the hardcoded testSubjects if localStorage is empty.
 * The admin Materials Manager writes to this key.
 * Merges admin data with the hardcoded subjects so we don't lose
 * description/pageDescription/etc. fields that the admin doesn't manage yet.
 *
 * Also passes through the new image-card fields the admin manages:
 *   - englishTitle:  English caption shown under the Arabic title.
 *                    Falls back to the hardcoded ENGLISH_TITLES map.
 *   - image:         Data URL of the uploaded card image (empty = gradient).
 *   - transform:     Image positioning { offsetX, offsetY, scale } chosen
 *                    in the admin ImagePositioner. Same shape as banner
 *                    transform so both editors can share a component.
 */
export function getTestSubjects() {
  try {
    const raw = localStorage.getItem(ADMIN_MATERIALS_KEY);
    if (!raw || raw === "[]") {
      // Fallback: merge hardcoded subjects with englishTitle and default fields
      return testSubjects.map((s) => ({
        ...s,
        title: s.title || s.name || s.id,
        englishTitle: ENGLISH_TITLES[s.id] || "",
        image: "",
        gradient: SUBJECT_GRADIENTS[s.id] || "linear-gradient(135deg, #1a3a5c, #0d1e30)",
        transform: { offsetX: 0, offsetY: 0, scale: 1 },
        available: s.available !== false,
      }));
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return testSubjects.map((s) => ({
        ...s,
        title: s.title || s.name || s.id,
        englishTitle: ENGLISH_TITLES[s.id] || "",
        image: "",
        gradient: SUBJECT_GRADIENTS[s.id] || "linear-gradient(135deg, #1a3a5c, #0d1e30)",
        transform: { offsetX: 0, offsetY: 0, scale: 1 },
        available: s.available !== false,
      }));
    }
    // Build a map of hardcoded subjects for merging extra fields
    const hardcodedMap = new Map(testSubjects.map((s) => [s.id, s]));
    return parsed
      .filter((item) => item && item.available !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((item) => {
        const hardcoded = hardcodedMap.get(item.id);
        const transform = item.transform && typeof item.transform === "object"
          ? {
              offsetX: Number(item.transform.offsetX) || 0,
              offsetY: Number(item.transform.offsetY) || 0,
              scale: Number(item.transform.scale) || 1,
            }
          : { offsetX: 0, offsetY: 0, scale: 1 };
        return {
          id: item.id,
          title: item.label || hardcoded?.title || item.id,
          name: item.label || hardcoded?.name || item.label || item.id,
          // English title: admin store wins, then hardcoded map, then empty.
          englishTitle: item.englishTitle || ENGLISH_TITLES[item.id] || "",
          icon: item.icon || hardcoded?.icon || "tests",
          description: hardcoded?.description || "",
          pageDescription: hardcoded?.pageDescription || "",
          stateLabel: hardcoded?.stateLabel || "قيد التجهيز",
          hasDiagramPractice: hardcoded?.hasDiagramPractice || false,
          available: item.available !== false,
          color: hardcoded?.color,
          // Image: if item has an imageKey, look it up in IndexedDB
          // (the admin stores image data there, NOT in localStorage).
          // Falls back to the inline `image` field (legacy) or empty.
          image:
            (item.imageKey && window.ImageDB && window.ImageDB.getImageSync(item.imageKey)) ||
            (typeof item.image === "string" ? item.image : ""),
          gradient:
            typeof item.gradient === "string"
              ? item.gradient
              : "linear-gradient(135deg, #1a3a5c, #0d1e30)",
          transform,
        };
      });
  } catch {
    return testSubjects.map((s) => ({
      ...s,
      title: s.title || s.name || s.id,
      englishTitle: ENGLISH_TITLES[s.id] || "",
      image: "",
      gradient: SUBJECT_GRADIENTS[s.id] || "linear-gradient(135deg, #1a3a5c, #0d1e30)",
      transform: { offsetX: 0, offsetY: 0, scale: 1 },
      available: s.available !== false,
    }));
  }
}

/**
 * Returns the live tools from the admin store.
 * Falls back to the hardcoded tools if localStorage is empty.
 * The admin Tools Manager writes to this key.
 * Merges admin data with hardcoded tools for description/status fields.
 */
export function getTools() {
  try {
    const raw = localStorage.getItem(ADMIN_TOOLS_KEY);
    if (!raw) return tools.slice();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return tools.slice();
    const hardcodedMap = new Map(tools.map((t) => [t.id, t]));
    return parsed
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((item) => {
        const hardcoded = hardcodedMap.get(item.id);
        return {
          id: item.id,
          title: item.label || hardcoded?.title || item.id,
          status: hardcoded?.status || (item.available ? "متاح الآن" : "قريبًا"),
          statusClass: hardcoded?.statusClass || (item.available ? "is-live" : "is-soon"),
          hint: hardcoded?.hint || "",
          icon: item.icon || hardcoded?.icon || "repeat",
          description: hardcoded?.description || "",
          available: item.available,
        };
      });
  } catch {
    return tools.slice();
  }
}
