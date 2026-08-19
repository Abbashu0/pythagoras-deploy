const ADMIN_BANNERS_KEY = "pythagoras-admin-banners";
const ADMIN_MATERIALS_KEY = "pythagoras-admin-materials";
const ADMIN_TOOLS_KEY = "pythagoras-admin-tools";
const ADMIN_NAV_KEY = "pythagoras-admin-nav";

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
  { id: "biology", title: "الأحياء", englishTitle: "BIOLOGY", description: "مادة الأحياء للسادس العلمي.", icon: "biology", stateLabel: "متاح", gradient: "linear-gradient(135deg, #166534, #0a3d20)" },
  { id: "math", title: "الرياضيات", englishTitle: "MATHEMATICS", description: "مادة الرياضيات للسادس العلمي.", icon: "math", stateLabel: "متاح", gradient: "linear-gradient(135deg, #7c2d12, #4a1a08)" },
  { id: "physics", title: "الفيزياء", englishTitle: "PHYSICS", description: "مادة الفيزياء للسادس العلمي.", icon: "physics", stateLabel: "متاح", gradient: "linear-gradient(135deg, #1e3a8a, #0f1e4a)" },
  { id: "chemistry", title: "الكيمياء", englishTitle: "CHEMISTRY", description: "مادة الكيمياء للسادس العلمي.", icon: "chemistry", stateLabel: "متاح", gradient: "linear-gradient(135deg, #6b21a8, #3b0764)" },
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

export const viewNavMap = { home: "home", materials: "materials", lectures: "materials", tests: "tools", questions: "tools", tools: "tools", settings: "settings" };
export const themeLabels = { dark: "داكن", light: "فاتح", aurora: "شفق" };
export const densityLabels = { compact: "صغير", comfortable: "قياسي", spacious: "كبير" };

export function getNavItems() { return readLocalArray(ADMIN_NAV_KEY, defaultNav); }
export function getSponsoredBanners() { return readLocalArray(ADMIN_BANNERS_KEY, defaultBanners); }
export function getTestSubjects() { return readLocalArray(ADMIN_MATERIALS_KEY, defaultSubjects); }
export function getTools() { return readLocalArray(ADMIN_TOOLS_KEY, defaultTools); }
export function getMaterialsSettings() { return { fadeIntensity: 0.72, textVerticalPosition: 0, textScale: 1, cardHeight: 213 }; }
export function getMaterialsFadeIntensity() { return getMaterialsSettings().fadeIntensity; }
export function getTestsSubjectView(subjectId) { return `subject-${subjectId}`; }
export function getSubjectByView(view) { return view.startsWith("subject-") ? getTestSubjects().find((subject) => subject.id === view.slice(8)) || null : null; }
export function getViewMeta(view) { return screens[view] || screens.tests; }
