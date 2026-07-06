export const themeLabels = { dark: "داكن", light: "فاتح", aurora: "شفق" };

export const densityLabels = {
  compact: "صغير",
  comfortable: "قياسي",
  spacious: "كبير",
};

export const tools = [
  {
    id: "tests",
    title: "الاختبارات",
    status: "متاح الآن",
    statusClass: "is-live",
    hint: "ابدأ من هنا",
    icon: "tests",
    available: true,
    view: "tests",
    description: "بنك اسئلة و اختبارات مخصصة حسب المادة والفصل والموضوع ونوع السؤال.",
  },
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
  { id: "tasks", label: "المهام", icon: "tasks" },
  { id: "tools", label: "الأدوات", icon: "spark-grid" },
  { id: "notes", label: "الملاحظات", icon: "notes" },
  { id: "settings", label: "الإعدادات", icon: "settings" },
];

export const viewNavMap = {
  home: "home",
  tasks: "tasks",
  tools: "tools",
  notes: "notes",
  settings: "settings",
  tests: "tools",
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
  viewNavMap[getTestsSubjectView(subject.id)] = "tools";
  viewNavMap[getQuestionBankView(subject.id)] = "tools";
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
    iconKey: "biology",
    image: "linear-gradient(135deg, oklch(58% 0.13 145), oklch(48% 0.10 165))",
    title: "مراجعة الأحياء",
    subtitle: "ملخص شامل للفصول الأربعة مع نماذج وزارية",
    destination: "tests-biology",
    enabled: true,
    displayOrder: 1,
  },
  {
    id: "math-course",
    iconKey: "math",
    image: "linear-gradient(135deg, oklch(60% 0.16 25), oklch(50% 0.18 15))",
    title: "دورة الرياضيات",
    subtitle: "تفاضل وتكامل شرح كامل بمستوى السادس علمي",
    destination: "tests-math",
    enabled: true,
    displayOrder: 2,
  },
  {
    id: "chemistry-course",
    iconKey: "chemistry",
    image: "linear-gradient(135deg, oklch(62% 0.14 280), oklch(52% 0.16 270))",
    title: "كورس الكيمياء",
    subtitle: "التفاعلات والحسابات الكيميائية بأسلوب مبسّط",
    destination: "tests-chemistry",
    enabled: true,
    displayOrder: 3,
  },
  {
    id: "physics-course",
    iconKey: "physics",
    image: "linear-gradient(135deg, oklch(60% 0.14 220), oklch(50% 0.16 240))",
    title: "دورة الفيزياء",
    subtitle: "الميكانيك والكهرباء بحلول مسائل خطوة بخطوة",
    destination: "tests-physics",
    enabled: true,
    displayOrder: 4,
  },
  {
    id: "teacher-course",
    iconKey: "lectures",
    image: "linear-gradient(135deg, oklch(60% 0.18 350), oklch(50% 0.16 340))",
    title: "كورس المعلم",
    subtitle: "جلسات مكثفة مع نخبة من المعلمين قبل الامتحان",
    destination: "tests",
    enabled: true,
    displayOrder: 5,
  },
];
