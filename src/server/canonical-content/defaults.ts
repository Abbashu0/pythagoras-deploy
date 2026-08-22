export const CANONICAL_BOOTSTRAP_VERSION = 1;

export const CANONICAL_BANNER_DEFAULTS = [
  { bannerType: "SPLIT", title: "مراجعة الأحياء", subtitle: "ملخص شامل للفصول الأربعة مع نماذج وزارية", iconKey: "biology", gradient: "linear-gradient(135deg, oklch(58% 0.13 145), oklch(48% 0.10 165))", status: "ACTIVE", displayOrder: 1, offsetX: 0, offsetY: 0, scale: 1 },
  { bannerType: "SPLIT", title: "دورة الرياضيات", subtitle: "تفاضل وتكامل شرح كامل بمستوى السادس علمي", iconKey: "math", gradient: "linear-gradient(135deg, oklch(60% 0.16 25), oklch(50% 0.18 15))", status: "ACTIVE", displayOrder: 2, offsetX: 0, offsetY: 0, scale: 1 },
  { bannerType: "SPLIT", title: "كورس الكيمياء", subtitle: "التفاعلات والحسابات الكيميائية بأسلوب مبسّط", iconKey: "chemistry", gradient: "linear-gradient(135deg, oklch(62% 0.14 280), oklch(52% 0.16 270))", status: "ACTIVE", displayOrder: 3, offsetX: 0, offsetY: 0, scale: 1 },
  { bannerType: "SPLIT", title: "دورة الفيزياء", subtitle: "الميكانيك والكهرباء بحلول مسائل خطوة بخطوة", iconKey: "physics", gradient: "linear-gradient(135deg, oklch(60% 0.14 220), oklch(50% 0.16 240))", status: "ACTIVE", displayOrder: 4, offsetX: 0, offsetY: 0, scale: 1 },
  { bannerType: "SPLIT", title: "كورس المعلم", subtitle: "جلسات مكثفة مع نخبة من المعلمين قبل الامتحان", iconKey: "lectures", gradient: "linear-gradient(135deg, oklch(60% 0.18 350), oklch(50% 0.16 340))", status: "ACTIVE", displayOrder: 5, offsetX: 0, offsetY: 0, scale: 1 },
] as const;

export const CANONICAL_MATERIAL_DEFAULTS = [
  { subjectKey: "islamic", label: "التربية الإسلامية", englishTitle: "ISLAMIC", iconKey: "islamic", available: true, displayOrder: 0, gradient: "linear-gradient(135deg, #1a5c3a, #0d3a24)" },
  { subjectKey: "arabic", label: "اللغة العربية", englishTitle: "ARABIC", iconKey: "arabic", available: true, displayOrder: 1, gradient: "linear-gradient(135deg, #8b4513, #5c2e0a)" },
  { subjectKey: "english", label: "اللغة الإنجليزية", englishTitle: "ENGLISH", iconKey: "english", available: true, displayOrder: 2, gradient: "linear-gradient(135deg, #1e3a8a, #0f1e4a)" },
  { subjectKey: "biology", label: "الأحياء", englishTitle: "BIOLOGY", iconKey: "biology", available: true, displayOrder: 3, gradient: "linear-gradient(135deg, #166534, #0a3d20)" },
  { subjectKey: "math", label: "الرياضيات", englishTitle: "MATHEMATICS", iconKey: "math", available: true, displayOrder: 4, gradient: "linear-gradient(135deg, #7c2d12, #4a1a08)" },
  { subjectKey: "chemistry", label: "الكيمياء", englishTitle: "CHEMISTRY", iconKey: "chemistry", available: true, displayOrder: 5, gradient: "linear-gradient(135deg, #581c87, #2e0a4a)" },
  { subjectKey: "physics", label: "الفيزياء", englishTitle: "PHYSICS", iconKey: "physics", available: true, displayOrder: 6, gradient: "linear-gradient(135deg, #0c4a6e, #062840)" },
  { subjectKey: "french", label: "اللغة الفرنسية", englishTitle: "FRENCH", iconKey: "french", available: false, displayOrder: 7, gradient: "linear-gradient(135deg, #1e40af, #0a1e5a)" },
] as const;

export const CANONICAL_TOOL_DEFAULTS = [
  { toolKey: "spaced", label: "التكرار المتباعد", iconKey: "repeat", available: false, displayOrder: 0 },
  { toolKey: "pomodoro", label: "بومودورو", iconKey: "timer", available: false, displayOrder: 1 },
  { toolKey: "notebook", label: "دفتري", iconKey: "notebook", available: false, displayOrder: 2 },
  { toolKey: "assistants", label: "المساعدون الأذكياء", iconKey: "brain", available: false, displayOrder: 3 },
  { toolKey: "lectures", label: "المحاضرات", iconKey: "lectures", available: false, displayOrder: 4 },
] as const;

export const CANONICAL_NAVIGATION_DEFAULTS = [
  { navKey: "home", label: "الرئيسية", iconKey: "home", enabled: true, displayOrder: 0 },
  { navKey: "materials", label: "المواد", iconKey: "book", enabled: true, displayOrder: 1 },
  { navKey: "tools", label: "الأدوات", iconKey: "toolbox", enabled: true, displayOrder: 2 },
  { navKey: "lectures", label: "المحاضرات", iconKey: "play", enabled: true, displayOrder: 3 },
  { navKey: "settings", label: "الإعدادات", iconKey: "settings", enabled: true, displayOrder: 4 },
] as const;

export const CANONICAL_MATERIAL_SETTINGS_DEFAULT = {
  fadeIntensity: 0.72,
  textVerticalPosition: 0,
  textScale: 1,
  cardHeight: 213,
} as const;

export const CANONICAL_CAROUSEL_SETTINGS_DEFAULT = { autoSlideInterval: 10_000 } as const;
