const biologyQuestionBankFiles = [
  {
    chapterId: "chapter-1",
    fileName: "biology-chapter-1.original-question-bank.display-ready.v6-plus-new-ministerial.json",
    url: "../data/biology/original-question-bank/biology-chapter-1.original-question-bank.display-ready.v6-plus-new-ministerial.json",
  },
  {
    chapterId: "chapter-2",
    fileName: "biology-chapter-2.original-question-bank.display-ready.v6-plus-new-ministerial.json",
    url: "../data/biology/original-question-bank/biology-chapter-2.original-question-bank.display-ready.v6-plus-new-ministerial.json",
  },
  {
    chapterId: "chapter-3",
    fileName: "biology-chapter-3.original-question-bank.display-ready.v6-plus-new-ministerial.json",
    url: "../data/biology/original-question-bank/biology-chapter-3.original-question-bank.display-ready.v6-plus-new-ministerial.json",
  },
  {
    chapterId: "chapter-4",
    fileName: "biology-chapter-4.original-question-bank.display-ready.v6-plus-new-ministerial.json",
    url: "../data/biology/original-question-bank/biology-chapter-4.original-question-bank.display-ready.v6-plus-new-ministerial.json",
  },
];

const biologyQuestionBankState = {
  status: "idle",
  records: [],
  chapterCounts: [],
  totalCount: 0,
  byGlobalOrder: new Map(),
  error: null,
};

const questionBankQueryState = {
  biology: "",
};

let biologyQuestionBankPromise = null;

function sanitizeQuestionBankQuery(query = "") {
  const value = String(query || "");
  if (!value.trim()) {
    return "";
  }

  const hasArabic = /[\u0600-\u06FF]/.test(value);
  const hasLatinMojibake = /[ÃØÙ]/.test(value);
  const hasCjkGarble = /[\u3400-\u9FFF]/.test(value);

  if (!hasArabic && (hasLatinMojibake || hasCjkGarble)) {
    return "";
  }

  return value;
}

function normalizeDigits(value = "") {
  return value
    .replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit).toString())
    .replace(/[۰-۹]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹".indexOf(digit).toString());
}

export function normalizeArabic(value = "") {
  return normalizeDigits(String(value || ""))
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildQuestionOnlySearchText(record) {
  const searchFields = record.searchFields || {};
  const appearanceTexts = Array.isArray(record.appearances)
    ? record.appearances.map((appearance) => appearance?.questionText).filter(Boolean)
    : [];
  const normalizedOriginalQuestions = Array.isArray(searchFields.normalizedOriginalQuestions)
    ? searchFields.normalizedOriginalQuestions
    : [];

  return normalizeArabic([
    record.displayQuestion,
    searchFields.normalizedDisplayQuestion,
    ...appearanceTexts,
    ...normalizedOriginalQuestions,
  ].filter(Boolean).join(" "));
}

function adaptRecord(record) {
  const globalOrder = Number(record?.displayOrder?.global || 0);

  return {
    ...record,
    globalOrder,
    normalizedSearchText: buildQuestionOnlySearchText(record),
  };
}

export function getBiologyQuestionBankSnapshot() {
  return biologyQuestionBankState;
}

export function getQuestionBankQuery(subjectId) {
  const sanitized = sanitizeQuestionBankQuery(questionBankQueryState[subjectId] || "");
  questionBankQueryState[subjectId] = sanitized;
  return sanitized;
}

export function setQuestionBankQuery(subjectId, query) {
  questionBankQueryState[subjectId] = sanitizeQuestionBankQuery(query);
}

export async function loadBiologyOriginalQuestionBank() {
  if (biologyQuestionBankState.status === "ready") {
    return biologyQuestionBankState;
  }

  if (biologyQuestionBankPromise) {
    return biologyQuestionBankPromise;
  }

  biologyQuestionBankState.status = "loading";
  biologyQuestionBankState.error = null;

  biologyQuestionBankPromise = Promise.all(
    biologyQuestionBankFiles.map(async (entry) => {
      const response = await fetch(new URL(entry.url, import.meta.url));
      if (!response.ok) {
        throw new Error(`Failed to load ${entry.fileName}`);
      }

      const payload = await response.json();
      const records = Array.isArray(payload.records) ? payload.records : [];

      return {
        chapterId: payload.chapterId || entry.chapterId,
        chapterName: payload.chapterName || "",
        fileName: entry.fileName,
        count: records.length,
        records,
      };
    }),
  ).then((chapters) => {
    const mergedRecords = chapters
      .flatMap((chapter) => chapter.records)
      .map(adaptRecord)
      .sort((left, right) => left.globalOrder - right.globalOrder);

    biologyQuestionBankState.status = "ready";
    biologyQuestionBankState.records = mergedRecords;
    biologyQuestionBankState.chapterCounts = chapters.map((chapter) => ({
      chapterId: chapter.chapterId,
      chapterName: chapter.chapterName,
      fileName: chapter.fileName,
      count: chapter.count,
    }));
    biologyQuestionBankState.totalCount = mergedRecords.length;
    biologyQuestionBankState.byGlobalOrder = new Map(
      mergedRecords.map((record) => [record.globalOrder, record]),
    );
    biologyQuestionBankState.error = null;

    return biologyQuestionBankState;
  }).catch((error) => {
    biologyQuestionBankState.status = "error";
    biologyQuestionBankState.error = error;
    throw error;
  }).finally(() => {
    biologyQuestionBankPromise = null;
  });

  return biologyQuestionBankPromise;
}

export function searchQuestionBank(records, query) {
  const normalizedQuery = normalizeArabic(query);
  if (!normalizedQuery) {
    return records;
  }

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  if (!queryTokens.length) {
    return records;
  }

  return records.filter((record) => {
    const haystack = record.normalizedSearchText || "";
    return queryTokens.every((token) => haystack.includes(token));
  });
}

export function getBiologyQuestionByGlobalOrder(globalOrder) {
  return biologyQuestionBankState.byGlobalOrder.get(Number(globalOrder)) || null;
}
