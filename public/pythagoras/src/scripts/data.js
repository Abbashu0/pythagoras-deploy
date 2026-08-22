export const ADMIN_BANNERS_KEY = "pythagoras-admin-banners";
export const ADMIN_MATERIALS_KEY = "pythagoras-admin-materials";
export const ADMIN_MATERIALS_SETTINGS_KEY = `${ADMIN_MATERIALS_KEY}-settings`;
export const ADMIN_TOOLS_KEY = "pythagoras-admin-tools";
export const ADMIN_NAV_ITEMS_KEY = "pythagoras-admin-nav-items";

let runtimeContent = { runtimeSourceMode: "LEGACY", contentRevision: 0, content: null };

export async function loadRuntimeContent() {
  const response = await fetch("/api/content/app", { cache: "no-store" });
  const body = await response.json();
  if (!response.ok || body.ok !== true || !["LEGACY", "CANONICAL"].includes(body.runtimeSourceMode)) throw new Error("CONTENT_UNAVAILABLE");
  if (body.runtimeSourceMode === "CANONICAL" && (!body.content || typeof body.content !== "object")) throw new Error("CANONICAL_CONTENT_MISSING");
  runtimeContent = { runtimeSourceMode: body.runtimeSourceMode, contentRevision: body.contentRevision || 0, content: body.content || null };
  return runtimeContent;
}

export function isLegacyRuntimeContent() { return runtimeContent.runtimeSourceMode === "LEGACY"; }

export const screens = {
  home: { eyebrow: "منصة فيثاغورس", title: "مرحبًا بك", copy: "مساحتك الدراسية الهادئة.", stateLabel: "محلي", icon: "home" },
  materials: { eyebrow: "المواد", title: "المواد الدراسية", copy: "اختر المادة التي تريد مراجعتها.", stateLabel: "متاح", icon: "book" },
  lectures: { eyebrow: "المحاضرات", title: "المحاضرات", copy: "ستظهر المحاضرات هنا لاحقًا.", stateLabel: "قريبًا", icon: "play" },
  tests: { eyebrow: "الاختبارات", title: "المواد", copy: "اختر مادة للوصول إلى مساحتها الدراسية.", stateLabel: "محلي", icon: "tests" },
  questions: { eyebrow: "بنك الأسئلة", title: "بنك الأسئلة قيد البناء", copy: "سيُبنى نظام بنك الأسئلة الجديد لاحقًا بعد توفير البيانات والمواصفات.", stateLabel: "قريبًا", icon: "tests" },
  tools: { eyebrow: "الأدوات", title: "أدوات الدراسة", copy: "أدوات مساعدة ضمن تجربة فيثاغورس.", stateLabel: "محلي", icon: "tools" },
  settings: { eyebrow: "الإعدادات", title: "الإعدادات", copy: "اضبط تجربة العرض المناسبة لك.", stateLabel: "محلي", icon: "settings" },
};

const defaultSubjects = [
  { id: "islamic", title: "التربية الإسلامية", englishTitle: "ISLAMIC", icon: "islamic", available: true, order: 0, gradient: "linear-gradient(135deg, #1a5c3a, #0d3a24)" },
  { id: "arabic", title: "اللغة العربية", englishTitle: "ARABIC", icon: "arabic", available: true, order: 1, gradient: "linear-gradient(135deg, #8b4513, #5c2e0a)" },
  { id: "english", title: "اللغة الإنجليزية", englishTitle: "ENGLISH", icon: "english", available: true, order: 2, gradient: "linear-gradient(135deg, #1e3a8a, #0f1e4a)" },
  { id: "biology", title: "الأحياء", englishTitle: "BIOLOGY", icon: "biology", available: true, order: 3, gradient: "linear-gradient(135deg, #166534, #0a3d20)" },
  { id: "math", title: "الرياضيات", englishTitle: "MATHEMATICS", icon: "math", available: true, order: 4, gradient: "linear-gradient(135deg, #7c2d12, #4a1a08)" },
  { id: "chemistry", title: "الكيمياء", englishTitle: "CHEMISTRY", icon: "chemistry", available: true, order: 5, gradient: "linear-gradient(135deg, #581c87, #2e0a4a)" },
  { id: "physics", title: "الفيزياء", englishTitle: "PHYSICS", icon: "physics", available: true, order: 6, gradient: "linear-gradient(135deg, #0c4a6e, #062840)" },
  { id: "french", title: "اللغة الفرنسية", englishTitle: "FRENCH", icon: "french", available: false, order: 7, gradient: "linear-gradient(135deg, #1e40af, #0a1e5a)" },
];

const defaultTools = [
  { id: "tests", title: "الاختبارات", description: "استكشف مساحات المواد الدراسية.", icon: "tests", status: "متاح", statusClass: "is-live", hint: "ابدأ الآن", available: true },
  { id: "notes", title: "الملاحظات", description: "أداة الملاحظات ستتوفر لاحقًا.", icon: "notes", status: "قريبًا", statusClass: "is-soon", hint: "قريبًا", available: false },
];

const defaultNav = [
  { id: "home", label: "الرئيسية", icon: "home" },
  { id: "materials", label: "المواد", icon: "book" },
  { id: "tools", label: "الأدوات", icon: "tools" },
  { id: "settings", label: "الإعدادات", icon: "settings" },
];

const defaultBanners = [
  { id: "welcome", title: "فيثاغورس", subtitle: "مساحتك الدراسية المحلية", iconKey: "brain", image: "linear-gradient(135deg, #4f9cff, #2a6fcc)", enabled: true, displayOrder: 0 },
];

function readLocalArray(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "");
    return Array.isArray(value) && value.length ? value : fallback;
  } catch {
    return fallback;
  }
}

export const viewNavMap = { home: "home", materials: "materials", lectures: "lectures", tests: "tools", questions: "tools", tools: "tools", settings: "settings" };
export const themeLabels = { dark: "داكن", light: "فاتح", aurora: "شفق" };
export const densityLabels = { compact: "صغير", comfortable: "قياسي", spacious: "كبير" };

export function getNavItems() {
  if (!isLegacyRuntimeContent()) return runtimeContent.content.navigation
    .filter((item) => item.enabled !== false)
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((item) => ({ id: item.navKey, label: item.label, icon: item.iconKey }));
  return readLocalArray(ADMIN_NAV_ITEMS_KEY, defaultNav)
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item && item.enabled !== false)
    .sort(({ item: left, index: leftIndex }, { item: right, index: rightIndex }) => {
      const leftOrder = Number.isFinite(left.order) ? left.order : leftIndex;
      const rightOrder = Number.isFinite(right.order) ? right.order : rightIndex;
      return leftOrder - rightOrder;
    })
    .map(({ item }) => item);
}

function readLocalObject(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "");
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value, min, max, fallback) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function storedImage(item) {
  if (!isLegacyRuntimeContent() && typeof item.imageUrl === "string") return item.imageUrl;
  if (typeof item.image === "string" && item.image) return item.image;
  if (typeof item.imageKey === "string" && window.ImageDB) {
    return window.ImageDB.getImageSync(item.imageKey);
  }
  return "";
}

function normalizeMaterial(item, index) {
  const title = typeof item.label === "string" ? item.label : item.title || "";
  return {
    ...item,
    id: typeof item.id === "string" ? item.id : `material-${index}`,
    title,
    englishTitle: typeof item.englishTitle === "string" ? item.englishTitle : "",
    description: typeof item.description === "string" ? item.description : "",
    icon: typeof item.icon === "string" ? item.icon : "book",
    stateLabel: item.available === false ? "قريبًا" : "متاح",
    image: storedImage(item),
    order: Number.isFinite(item.order) ? item.order : index,
  };
}

function normalizeBanner(item, index) {
  return {
    ...item,
    id: typeof item.id === "string" ? item.id : `banner-${index}`,
    title: typeof item.title === "string" ? item.title : "",
    subtitle: typeof item.subtitle === "string" ? item.subtitle : "",
    iconKey: typeof item.iconKey === "string" ? item.iconKey : "brain",
    image: storedImage(item),
    enabled: item.enabled !== false && item.status !== "archived",
    displayOrder: Number.isFinite(item.displayOrder) ? item.displayOrder : index,
  };
}

function normalizeTool(item, index) {
  const available = item.available === true;
  const title = typeof item.label === "string" ? item.label : item.title || "";
  return {
    ...item,
    id: typeof item.id === "string" ? item.id : `tool-${index}`,
    title,
    description: typeof item.description === "string"
      ? item.description
      : available
      ? "أداة دراسية متاحة ضمن منصة فيثاغورس."
      : "هذه الأداة ستتوفر لاحقًا.",
    icon: item.icon === "lectures" ? "play" : typeof item.icon === "string" ? item.icon : "toolbox",
    available,
    status: available ? "متاح" : "قريبًا",
    statusClass: available ? "is-live" : "is-soon",
    hint: available ? "ابدأ الآن" : "قريبًا",
    order: Number.isFinite(item.order) ? item.order : index,
  };
}
export function getSponsoredBanners() {
  if (!isLegacyRuntimeContent()) return runtimeContent.content.banners.map((item) => normalizeBanner({ ...item, enabled: item.status === "ACTIVE", image: item.imageUrl })).filter((banner) => banner.enabled).sort((left, right) => left.displayOrder - right.displayOrder);
  return readLocalArray(ADMIN_BANNERS_KEY, defaultBanners)
    .map(normalizeBanner)
    .filter((banner) => banner.enabled)
    .sort((left, right) => left.displayOrder - right.displayOrder);
}
export function getTestSubjects() {
  if (!isLegacyRuntimeContent()) return runtimeContent.content.materials.map((item) => normalizeMaterial({ ...item, id: item.subjectKey, icon: item.iconKey, order: item.displayOrder, image: item.imageUrl })).filter((subject) => subject.available !== false).sort((left, right) => left.order - right.order);
  return readLocalArray(ADMIN_MATERIALS_KEY, defaultSubjects)
    .map(normalizeMaterial)
    .filter((subject) => subject.available !== false)
    .sort((left, right) => left.order - right.order);
}
export function getTools() {
  if (!isLegacyRuntimeContent()) return runtimeContent.content.tools.map((item) => normalizeTool({ ...item, id: item.toolKey, icon: item.iconKey, order: item.displayOrder })).sort((left, right) => left.order - right.order);
  return readLocalArray(ADMIN_TOOLS_KEY, defaultTools)
    .map(normalizeTool)
    .sort((left, right) => left.order - right.order);
}
export function getMaterialsSettings() {
  if (!isLegacyRuntimeContent()) return runtimeContent.content.materialSettings;
  const settings = readLocalObject(ADMIN_MATERIALS_SETTINGS_KEY, {});
  return {
    fadeIntensity: clamp(settings.fadeIntensity, 0, 1, 0.72),
    textVerticalPosition: clamp(settings.textVerticalPosition, -100, 100, 0),
    textScale: clamp(settings.textScale, 0.8, 1.4, 1),
    cardHeight: Math.round(clamp(settings.cardHeight, 160, 340, 213)),
  };
}
export function getCarouselAutoSlideInterval() {
  if (!isLegacyRuntimeContent()) return runtimeContent.content.carouselSettings.autoSlideInterval;
  const settings = readLocalObject("pythagoras-admin-carousel-settings", {});
  return clamp(settings.autoSlideInterval, 1000, 120000, 10_000);
}
export function getMaterialsFadeIntensity() { return getMaterialsSettings().fadeIntensity; }
export function getTestsSubjectView(subjectId) { return `subject-${subjectId}`; }
export function getSubjectByView(view) { return view.startsWith("subject-") ? getTestSubjects().find((subject) => subject.id === view.slice(8)) || null : null; }
export function getViewMeta(view) { return screens[view] || screens.tests; }
