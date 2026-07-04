import { normalizeArabic, searchQuestionBank } from "./biologyQuestionBank.js";

export const QUESTION_BANK_SOURCE_OPTIONS = [
  { id: "ministerial", label: "وزاري" },
  { id: "educational-tv", label: "أسئلة التلفزيون التربوي" },
  { id: "end-chapter", label: "أسئلة الفصل" },
];

export const BIOLOGY_CHAPTER_OPTIONS = [
  {
    id: "chapter-1",
    shortLabel: "الفصل الأول",
    fullLabel: "الفصل الأول: الخلية",
    topics: [
      "مقدمة الفصل الاول",
      "نظرية الخلية",
      "الخلية بدائية النواة",
      "الخلية حقيقية النواة",
      "جدار الخلية",
      "الغشاء البلازمي",
      "السايتوبلازم",
      "الشبكة البلازمية الداخلية",
      "جهاز كولجي",
      "المايتوكوندريا",
      "البلاستيدات",
      "الجسيمات الحالة",
      "هيكل الخلية",
      "المحتويات غير الحية للخلية",
      "النواة",
      "الانشطة الخلوية",
      "الايض الخلوي",
      "التنفس",
      "انقسام الخلية",
    ],
  },
  {
    id: "chapter-2",
    shortLabel: "الفصل الثاني",
    fullLabel: "الفصل الثاني: الأنسجة",
    topics: [
      "مقدمة الفصل الثاني",
      "النسيج المرستيمي (الانشائي)",
      "النسيج الاساس",
      "نسيج البشرة",
      "النسيج الوعائي",
      "النسيج الظهاري (الطلائي)",
      "النسيج الضام (الرابط)",
      "خلايا النسيج الضام",
      "الياف النسيج الضام",
      "تصنيف الانسجة الضامة",
      "النسيج الضام الرخو (المفكك)",
      "النسيج الضام الكثيف",
      "الغضروف",
      "العظم",
      "الدم",
      "الدم-خلايا الدم الحمر",
      "الدم-خلايا الدم البيض",
      "الدم-الصفيحات الدموية",
      "الدم-البلازما",
      "الدم-اللمف",
      "النسيج العضلي",
      "النسيج العضلي-العضلات الملساء",
      "النسيج العضلي-العضلات الهيكلية",
      "النسيج العضلي-العضلات القلبية",
      "النسيج العصبي",
    ],
  },
  {
    id: "chapter-3",
    shortLabel: "الفصل الثالث",
    fullLabel: "الفصل الثالث: التكاثر",
    topics: [
      "مقدمة الفصل الثالث",
      "التكاثر الجنسي و اللاجنسي",
      "تكوين النطف (الحيوانات المنوية)",
      "تكوين البيوض",
      "التكاثر في الفيروسات",
      "التكاثر في البكتيريا",
      "التكاثر في الكلاميدوموناس",
      "التكاثر في البراميسيوم",
      "التكاثر في اليوغلينا",
      "التكاثر في فطر عفن الخبز الاسود",
      "التكاثر في النباتات",
      "التكاثر في الحزازيات",
      "التكاثر في السرخسيات",
      "التكاثر في النباتات الزهرية",
      "المتك و تكوين حبوب اللقاح",
      "المبيض و تكوين البويضات",
      "التلقيح",
      "تركيب الثمرة",
      "انتشار البذور و الثمار",
      "التكاثر في الحشرات",
      "التكاثر في الضفدع",
      "التكاثر في الانسان-الجهاز التناسلي الذكري في الانسان",
      "التكاثر في الانسان-الجهاز التناسلي الانثوي في الانسان",
      "التكاثر في الانسان-الاخصاب و الحمل",
      "التكاثر العذري",
      "التكاثر الخنثي",
    ],
  },
  {
    id: "chapter-4",
    shortLabel: "الفصل الرابع",
    fullLabel: "الفصل الرابع: النمو والتكوين الجنيني",
    topics: [
      "مقدمة الفصل الرابع",
      "مفهوم النمو",
      "مفهوم التمايز الخلوي",
      "مستويات التعضي في تعقيد الحيوان",
      "مفهوم التكوين الجنيني",
      "التشوهات الجنينية في الانسان",
      "تعدد المواليد و تكوين التوائم",
      "المباعدة بين الولادات",
      "الخلايا الجذعية",
      "الاستنساخ في الحيوان",
      "تقانات في علاج العقم",
    ],
  },
];

const chapterLookup = new Map();
const topicLookup = new Map();
const ministerialRefPattern = /وزاري|تمهيدي|محاولات|التكميلي|خارج القطر|المتميزين|الموصل|النازحين|الغائبين|^\d+\/\d+/;

BIOLOGY_CHAPTER_OPTIONS.forEach((chapter) => {
  chapterLookup.set(chapter.id, chapter);
  chapterLookup.set(normalizeArabic(chapter.shortLabel), chapter);
  chapterLookup.set(normalizeArabic(chapter.fullLabel), chapter);

  chapter.topics.forEach((topic) => {
    topicLookup.set(normalizeArabic(topic), {
      id: topic,
      label: topic,
      chapterId: chapter.id,
    });
  });
});

function ensureArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function getQuestionChapterConfig(record) {
  return (
    chapterLookup.get(record?.chapterId)
    || chapterLookup.get(normalizeArabic(record?.chapterName || ""))
    || null
  );
}

export function getQuestionChapterLabel(record) {
  return record?.chapterName || getQuestionChapterConfig(record)?.shortLabel || "غير مصنف";
}

export function getQuestionTypeLabel(record) {
  return String(record?.questionTypeLabel || "").trim() || "غير مصنف";
}

export function getQuestionSourceIds(record) {
  const sourceSummary = record?.sourceSummary || {};
  const refs = [
    sourceSummary.primaryLabel,
    ...ensureArray(sourceSummary.allRefs),
    ...ensureArray(sourceSummary.nonMinisterialSources),
    ...ensureArray(record?.sourceRefs),
    ...ensureArray(record?.appearances).flatMap((appearance) => ensureArray(appearance?.refs)),
  ].map((value) => String(value || "").trim()).filter(Boolean);

  const ids = new Set();

  if (sourceSummary.hasMinisterial || sourceSummary.hasOfficialExamRefs || Number(sourceSummary.officialExamCount || 0) > 0) {
    ids.add("ministerial");
  }

  if (sourceSummary.hasEducationalTv || refs.some((ref) => ref.includes("التلفزيون التربوي"))) {
    ids.add("educational-tv");
  }

  if (sourceSummary.hasEndChapter || refs.some((ref) => ref.includes("أسئلة الفصل"))) {
    ids.add("end-chapter");
  }

  if (!ids.size && refs.some((ref) => ministerialRefPattern.test(ref))) {
    ids.add("ministerial");
  }

  return [...ids];
}

export function getOfficialTopicInfo(record) {
  const chapter = getQuestionChapterConfig(record);
  const candidates = [
    record?.primaryTopic?.name,
    ...ensureArray(record?.topics).map((topic) => topic?.name),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const match = topicLookup.get(normalizeArabic(candidate));
    if (!match) {
      continue;
    }

    if (!chapter || match.chapterId === chapter.id) {
      return {
        id: match.id,
        label: match.label,
        chapterId: match.chapterId,
        isUncategorized: false,
      };
    }
  }

  return {
    id: `uncategorized:${chapter?.id || record?.chapterId || "unknown"}`,
    label: "غير مصنف",
    chapterId: chapter?.id || record?.chapterId || "unknown",
    isUncategorized: true,
  };
}

function buildQuestionTypes(records) {
  const typeMap = new Map();

  records.forEach((record) => {
    const label = getQuestionTypeLabel(record);
    if (!typeMap.has(label)) {
      typeMap.set(label, { id: label, label });
    }
  });

  return [...typeMap.values()];
}

export function buildQuestionBankFilterOptions(records, selectedChapterIds = null) {
  const chapterIds = Array.isArray(selectedChapterIds) && selectedChapterIds.length
    ? selectedChapterIds
    : BIOLOGY_CHAPTER_OPTIONS.map((chapter) => chapter.id);
  const allowedChapters = new Set(chapterIds);

  const uncategorizedChapters = new Set();
  records.forEach((record) => {
    const topicInfo = getOfficialTopicInfo(record);
    if (topicInfo.isUncategorized && allowedChapters.has(topicInfo.chapterId)) {
      uncategorizedChapters.add(topicInfo.chapterId);
    }
  });

  const topics = [];
  BIOLOGY_CHAPTER_OPTIONS.forEach((chapter) => {
    if (!allowedChapters.has(chapter.id)) {
      return;
    }

    chapter.topics.forEach((topic) => {
      topics.push({
        id: topic,
        label: topic,
        chapterId: chapter.id,
      });
    });

    if (uncategorizedChapters.has(chapter.id)) {
      topics.push({
        id: `uncategorized:${chapter.id}`,
        label: "غير مصنف",
        chapterId: chapter.id,
      });
    }
  });

  return {
    sources: QUESTION_BANK_SOURCE_OPTIONS,
    chapters: BIOLOGY_CHAPTER_OPTIONS.map((chapter) => ({
      id: chapter.id,
      label: chapter.shortLabel,
      fullLabel: chapter.fullLabel,
    })),
    topics,
    questionTypes: buildQuestionTypes(records),
  };
}

export function createDefaultQuestionBankFilters(records) {
  const options = buildQuestionBankFilterOptions(records);

  return {
    sourceIds: options.sources.map((item) => item.id),
    chapterIds: options.chapters.map((item) => item.id),
    topicIds: options.topics.map((item) => item.id),
    questionTypeIds: options.questionTypes.map((item) => item.id),
  };
}

export function normalizeQuestionBankFilters(records, filters = {}) {
  const defaults = createDefaultQuestionBankFilters(records);

  const keepAtLeastOne = (selectedIds, allIds, fallbackIds = allIds) => {
    const next = ensureArray(selectedIds).filter((id) => allIds.includes(id));
    return next.length ? next : [...fallbackIds];
  };

  const chapterIds = keepAtLeastOne(filters.chapterIds, defaults.chapterIds, defaults.chapterIds);
  const topicOptions = buildQuestionBankFilterOptions(records, chapterIds).topics;
  const topicIds = keepAtLeastOne(
    filters.topicIds,
    topicOptions.map((item) => item.id),
    topicOptions.map((item) => item.id),
  );

  return {
    sourceIds: keepAtLeastOne(filters.sourceIds, defaults.sourceIds, defaults.sourceIds),
    chapterIds,
    topicIds,
    questionTypeIds: keepAtLeastOne(filters.questionTypeIds, defaults.questionTypeIds, defaults.questionTypeIds),
  };
}

export function hasActiveQuestionBankFilters(records, filters = {}) {
  const defaults = createDefaultQuestionBankFilters(records);
  const normalized = normalizeQuestionBankFilters(records, filters);
  const sameSelection = (left, right) => (
    left.length === right.length
    && left.every((value) => right.includes(value))
  );

  return (
    !sameSelection(normalized.sourceIds, defaults.sourceIds)
    || !sameSelection(normalized.chapterIds, defaults.chapterIds)
    || !sameSelection(normalized.topicIds, defaults.topicIds)
    || !sameSelection(normalized.questionTypeIds, defaults.questionTypeIds)
  );
}

export function applyQuestionBankFilters(records, state) {
  const normalized = normalizeQuestionBankFilters(records, state?.filters || {});

  return searchQuestionBank(records, state?.query || "")
    .filter((record) => {
      const sourceIds = getQuestionSourceIds(record);
      return sourceIds.some((id) => normalized.sourceIds.includes(id));
    })
    .filter((record) => normalized.chapterIds.includes(record.chapterId))
    .filter((record) => normalized.topicIds.includes(getOfficialTopicInfo(record).id))
    .filter((record) => normalized.questionTypeIds.includes(getQuestionTypeLabel(record)))
    .sort((left, right) => left.globalOrder - right.globalOrder);
}

export function buildBiologyTopicAudit(records) {
  const mismatchedNames = new Map();
  const unmatchedRecords = [];

  records.forEach((record) => {
    const official = getOfficialTopicInfo(record);
    const rawTopic = record?.primaryTopic?.name || "";

    if (official.isUncategorized) {
      unmatchedRecords.push(record);
      return;
    }

    if (rawTopic && normalizeArabic(rawTopic) !== normalizeArabic(official.label)) {
      mismatchedNames.set(rawTopic, official.label);
    }
  });

  return {
    unmatchedCount: unmatchedRecords.length,
    unmatchedRecords,
    mismatchedNames: [...mismatchedNames.entries()].map(([raw, official]) => ({ raw, official })),
  };
}
