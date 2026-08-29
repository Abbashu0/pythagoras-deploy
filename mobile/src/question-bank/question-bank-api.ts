import { getJson } from '@/api/client';

export type QuestionSourceKind =
  | 'ministerial'
  | 'discussion-question'
  | 'educational-tv'
  | 'end-of-chapter'
  | 'book-question'
  | 'book-exercise'
  | 'enrichment'
  | 'other';

export type QuestionTaxonomyRole = 'PRIMARY' | 'RELATED';
export type RichTextMark = 'bold' | 'italic' | 'underline';
export type RichInline = { text: string; marks?: RichTextMark[] }[];

export type PublicRichContentBlock =
  | { id: string; type: 'paragraph'; spans: RichInline }
  | { id: string; type: 'heading'; level: 2 | 3 | 4; spans: RichInline }
  | {
      id: string;
      type: 'ordered-list' | 'bullet-list';
      items: { spans: RichInline }[];
    }
  | {
      id: string;
      type: 'quran';
      verses: {
        id: string;
        spans: RichInline;
        surah?: string;
        ayah?: number;
      }[];
    }
  | {
      id: string;
      type: 'poetry';
      verses: { id: string; sadr: RichInline; ajuz: RichInline }[];
    }
  | {
      id: string;
      type: 'table';
      headerRowCount: number;
      caption?: RichInline;
      columnAlignments?: ('start' | 'center' | 'end')[];
      displayMode?: 'standard' | 'compact';
      rows: { cells: { spans: RichInline }[] }[];
    }
  | {
      id: string;
      type: 'image';
      src: string;
      alt: string;
      caption?: RichInline;
    }
  | { id: string; type: 'divider' };

export interface PublicRichDocument {
  type: 'doc';
  version: 1;
  blocks: PublicRichContentBlock[];
}

export interface PublicMaterialQuestionBankNode {
  id: string;
  nodeKey: string;
  label: string;
  nodeType: 'GROUP' | 'BANK';
  parentId: string | null;
  displayOrder: number;
  groupPresentation: string | null;
  available: boolean;
}

export interface PublicMaterialQuestionBankLayout {
  material: { id: string; subjectKey: string; label: string };
  rootPresentation: 'CARDS' | 'DIRECT';
  nodes: PublicMaterialQuestionBankNode[];
}

export interface PublicQuestionSourceSummary {
  sourceKind: QuestionSourceKind;
  count: number;
}

export interface PublicQuestionSummary {
  questionId: string;
  ordinal: number;
  primaryPreview: string;
  primaryPreviewRich: PublicRichDocument;
  taxonomyBreadcrumb: string;
  variantCount: number;
  occurrenceCount: number;
  sourceSummary: PublicQuestionSourceSummary[];
  hasAnswer: boolean;
}

export interface PublicQuestionPage {
  total: number;
  offset: number;
  limit: number;
  items: PublicQuestionSummary[];
}

export interface PublicQuestionSearchItem extends PublicQuestionSummary {
  bankOrdinal: number;
  matchContext:
    | 'PRIMARY_VARIANT'
    | 'ALTERNATE_VARIANT'
    | 'ANSWER'
    | 'TAXONOMY'
    | 'PROVENANCE';
  matchPreview: string;
}

export interface PublicQuestionSearchPage extends PublicQuestionPage {
  query: string;
  normalizedQuery: string;
  items: PublicQuestionSearchItem[];
}

export interface PublicQuestionOccurrence {
  id: string;
  displayOrder: number;
  sourceKind: QuestionSourceKind;
  year: number | null;
  roundCode: string | null;
  session: string | null;
  sourceName: string | null;
  notes: string | null;
  rawLabel: string;
  branches: string[];
  qualifiers: string[];
}

export interface PublicQuestionVariant {
  id: string;
  displayOrder: number;
  content: PublicRichDocument;
  occurrences: PublicQuestionOccurrence[];
}

export interface PublicQuestionDetail {
  questionId: string;
  canonicalOrder: number;
  primaryVariantId: string;
  variants: PublicQuestionVariant[];
  sharedAnswer: PublicRichDocument | null;
  taxonomy: {
    id: string;
    role: QuestionTaxonomyRole;
    position: number;
    breadcrumb: string;
  }[];
}

export const QUESTION_PAGE_SIZE = 50;
export const QUESTION_SEARCH_PAGE_SIZE = 25;

export class QuestionBankApiError extends Error {
  constructor(message: string, readonly code = 'QUESTION_BANK_UNAVAILABLE') {
    super(message);
    this.name = 'QuestionBankApiError';
  }
}

const questionDetailCache = new Map<string, PublicQuestionDetail>();
const QUESTION_DETAIL_CACHE_LIMIT = 20;

export async function fetchQuestionBankLayout(
  subjectKey: string,
  signal?: AbortSignal
): Promise<PublicMaterialQuestionBankLayout> {
  const payload = await getJson<unknown>(
    `/api/content/question-bank/${encodeURIComponent(subjectKey)}`,
    signal
  );
  const record = requireSuccessfulRecord(payload);

  if (!isPublicLayout(record.layout)) {
    throw new QuestionBankApiError('The Question Bank layout is invalid.', 'QUESTION_BANK_INVALID');
  }

  return record.layout;
}

export async function fetchQuestionPage(
  subjectKey: string,
  bankNodeId: string,
  offset: number,
  limit = QUESTION_PAGE_SIZE,
  signal?: AbortSignal
): Promise<PublicQuestionPage> {
  const payload = await getJson<unknown>(
    `/api/content/question-bank/${encodeURIComponent(subjectKey)}/banks/${encodeURIComponent(bankNodeId)}/questions?offset=${Math.max(0, Math.trunc(offset))}&limit=${Math.max(1, Math.trunc(limit))}`,
    signal
  );
  const record = requireSuccessfulRecord(payload);

  if (!isPublicQuestionPage(record.page)) {
    throw new QuestionBankApiError('The Question Bank page is invalid.', 'QUESTION_BANK_INVALID');
  }

  return record.page;
}

export async function fetchQuestionSearchPage(
  subjectKey: string,
  bankNodeId: string,
  query: string,
  offset: number,
  limit = QUESTION_SEARCH_PAGE_SIZE,
  signal?: AbortSignal
): Promise<PublicQuestionSearchPage> {
  const payload = await getJson<unknown>(
    `/api/content/question-bank/${encodeURIComponent(subjectKey)}/banks/${encodeURIComponent(bankNodeId)}/search?q=${encodeURIComponent(query)}&offset=${Math.max(0, Math.trunc(offset))}&limit=${Math.max(1, Math.trunc(limit))}`,
    signal
  );
  const record = requireSuccessfulRecord(payload);
  const page = { ...record, items: record.items };

  if (!isPublicQuestionSearchPage(page)) {
    throw new QuestionBankApiError('The Question Bank search page is invalid.', 'QUESTION_BANK_INVALID');
  }

  return page;
}

export async function fetchQuestionDetail(
  subjectKey: string,
  bankNodeId: string,
  questionId: string,
  signal?: AbortSignal
): Promise<PublicQuestionDetail> {
  const cacheKey = `${bankNodeId}:${questionId}`;
  const cached = questionDetailCache.get(cacheKey);
  if (cached) return cached;

  const payload = await getJson<unknown>(
    `/api/content/question-bank/${encodeURIComponent(subjectKey)}/banks/${encodeURIComponent(bankNodeId)}/questions/${encodeURIComponent(questionId)}`,
    signal
  );
  const record = requireSuccessfulRecord(payload);

  if (!isPublicQuestionDetail(record.question)) {
    throw new QuestionBankApiError('The Question detail is invalid.', 'QUESTION_BANK_INVALID');
  }

  if (questionDetailCache.size >= QUESTION_DETAIL_CACHE_LIMIT) {
    const oldestKey = questionDetailCache.keys().next().value;
    if (oldestKey) questionDetailCache.delete(oldestKey);
  }
  questionDetailCache.set(cacheKey, record.question);
  return record.question;
}

export function findAvailableBank(
  layout: PublicMaterialQuestionBankLayout,
  nodeKey: string
): PublicMaterialQuestionBankNode | null {
  return layout.nodes.find(
    (node) => node.nodeType === 'BANK' && node.nodeKey === nodeKey && node.available
  ) ?? null;
}

export function clearQuestionDetailCache() {
  questionDetailCache.clear();
}

interface JsonRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function requireSuccessfulRecord(payload: unknown): JsonRecord {
  if (!isRecord(payload) || payload.ok !== true) {
    throw new QuestionBankApiError('The Question Bank response was not successful.');
  }
  return payload;
}

function isRichInline(value: unknown): value is RichInline {
  return (
    Array.isArray(value) &&
    value.every((span) => {
      if (!isRecord(span) || typeof span.text !== 'string') return false;
      return (
        span.marks === undefined ||
        (Array.isArray(span.marks) &&
          span.marks.every(
            (mark) => mark === 'bold' || mark === 'italic' || mark === 'underline'
          ))
      );
    })
  );
}

function isRichDocument(value: unknown): value is PublicRichDocument {
  return (
    isRecord(value) &&
    value.type === 'doc' &&
    value.version === 1 &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isRichBlock)
  );
}

function isRichBlock(value: unknown): value is PublicRichContentBlock {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'paragraph':
      return isRichInline(value.spans);
    case 'heading':
      return (value.level === 2 || value.level === 3 || value.level === 4) && isRichInline(value.spans);
    case 'ordered-list':
    case 'bullet-list':
      return (
        Array.isArray(value.items) &&
        value.items.every((item) => isRecord(item) && isRichInline(item.spans))
      );
    case 'quran':
      return (
        Array.isArray(value.verses) &&
        value.verses.every(
          (verse) =>
            isRecord(verse) &&
            typeof verse.id === 'string' &&
            isRichInline(verse.spans) &&
            (verse.surah === undefined || typeof verse.surah === 'string') &&
            (verse.ayah === undefined || isFiniteNumber(verse.ayah))
        )
      );
    case 'poetry':
      return (
        Array.isArray(value.verses) &&
        value.verses.every(
          (verse) =>
            isRecord(verse) &&
            typeof verse.id === 'string' &&
            isRichInline(verse.sadr) &&
            isRichInline(verse.ajuz)
        )
      );
    case 'table':
      return (
        isFiniteNumber(value.headerRowCount) &&
        Array.isArray(value.rows) &&
        value.rows.every(
          (row) =>
            isRecord(row) &&
            Array.isArray(row.cells) &&
            row.cells.every((cell) => isRecord(cell) && isRichInline(cell.spans))
        ) &&
        (value.caption === undefined || isRichInline(value.caption)) &&
        (value.columnAlignments === undefined ||
          (Array.isArray(value.columnAlignments) &&
            value.columnAlignments.every(
              (alignment) => alignment === 'start' || alignment === 'center' || alignment === 'end'
            ))) &&
        (value.displayMode === undefined || value.displayMode === 'standard' || value.displayMode === 'compact')
      );
    case 'image':
      return (
        typeof value.src === 'string' &&
        typeof value.alt === 'string' &&
        (value.caption === undefined || isRichInline(value.caption))
      );
    case 'divider':
      return true;
    default:
      return false;
  }
}

function isSourceKind(value: unknown): value is QuestionSourceKind {
  return (
    value === 'ministerial' ||
    value === 'discussion-question' ||
    value === 'educational-tv' ||
    value === 'end-of-chapter' ||
    value === 'book-question' ||
    value === 'book-exercise' ||
    value === 'enrichment' ||
    value === 'other'
  );
}

function isPublicSourceSummary(value: unknown): value is PublicQuestionSourceSummary {
  return isRecord(value) && isSourceKind(value.sourceKind) && isFiniteNumber(value.count);
}

function isPublicQuestionSummary(value: unknown): value is PublicQuestionSummary {
  return (
    isRecord(value) &&
    typeof value.questionId === 'string' &&
    isFiniteNumber(value.ordinal) &&
    typeof value.primaryPreview === 'string' &&
    isRichDocument(value.primaryPreviewRich) &&
    typeof value.taxonomyBreadcrumb === 'string' &&
    isFiniteNumber(value.variantCount) &&
    isFiniteNumber(value.occurrenceCount) &&
    Array.isArray(value.sourceSummary) &&
    value.sourceSummary.every(isPublicSourceSummary) &&
    typeof value.hasAnswer === 'boolean'
  );
}

function isPublicQuestionPage(value: unknown): value is PublicQuestionPage {
  return (
    isRecord(value) &&
    isFiniteNumber(value.total) &&
    isFiniteNumber(value.offset) &&
    isFiniteNumber(value.limit) &&
    Array.isArray(value.items) &&
    value.items.every(isPublicQuestionSummary)
  );
}

function isPublicQuestionSearchItem(value: unknown): value is PublicQuestionSearchItem {
  return (
    isPublicQuestionSummary(value) &&
    isRecord(value) &&
    isFiniteNumber(value.bankOrdinal) &&
    (value.matchContext === 'PRIMARY_VARIANT' ||
      value.matchContext === 'ALTERNATE_VARIANT' ||
      value.matchContext === 'ANSWER' ||
      value.matchContext === 'TAXONOMY' ||
      value.matchContext === 'PROVENANCE') &&
    typeof value.matchPreview === 'string'
  );
}

function isPublicQuestionSearchPage(value: unknown): value is PublicQuestionSearchPage {
  return (
    isRecord(value) &&
    typeof value.query === 'string' &&
    typeof value.normalizedQuery === 'string' &&
    isFiniteNumber(value.total) &&
    isFiniteNumber(value.offset) &&
    isFiniteNumber(value.limit) &&
    Array.isArray(value.items) &&
    value.items.every(isPublicQuestionSearchItem)
  );
}

function isPublicOccurrence(value: unknown): value is PublicQuestionOccurrence {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isFiniteNumber(value.displayOrder) &&
    isSourceKind(value.sourceKind) &&
    (value.year === null || isFiniteNumber(value.year)) &&
    isNullableString(value.roundCode) &&
    isNullableString(value.session) &&
    isNullableString(value.sourceName) &&
    isNullableString(value.notes) &&
    typeof value.rawLabel === 'string' &&
    isStringArray(value.branches) &&
    isStringArray(value.qualifiers)
  );
}

function isPublicVariant(value: unknown): value is PublicQuestionVariant {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isFiniteNumber(value.displayOrder) &&
    isRichDocument(value.content) &&
    Array.isArray(value.occurrences) &&
    value.occurrences.every(isPublicOccurrence)
  );
}

function isPublicQuestionDetail(value: unknown): value is PublicQuestionDetail {
  return (
    isRecord(value) &&
    typeof value.questionId === 'string' &&
    isFiniteNumber(value.canonicalOrder) &&
    typeof value.primaryVariantId === 'string' &&
    Array.isArray(value.variants) &&
    value.variants.every(isPublicVariant) &&
    (value.sharedAnswer === null || isRichDocument(value.sharedAnswer)) &&
    Array.isArray(value.taxonomy) &&
    value.taxonomy.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        (item.role === 'PRIMARY' || item.role === 'RELATED') &&
        isFiniteNumber(item.position) &&
        typeof item.breadcrumb === 'string'
    )
  );
}

function isPublicLayout(value: unknown): value is PublicMaterialQuestionBankLayout {
  return (
    isRecord(value) &&
    isRecord(value.material) &&
    typeof value.material.id === 'string' &&
    typeof value.material.subjectKey === 'string' &&
    typeof value.material.label === 'string' &&
    (value.rootPresentation === 'CARDS' || value.rootPresentation === 'DIRECT') &&
    Array.isArray(value.nodes) &&
    value.nodes.every(
      (node) =>
        isRecord(node) &&
        typeof node.id === 'string' &&
        typeof node.nodeKey === 'string' &&
        typeof node.label === 'string' &&
        (node.nodeType === 'GROUP' || node.nodeType === 'BANK') &&
        (node.parentId === null || typeof node.parentId === 'string') &&
        isFiniteNumber(node.displayOrder) &&
        (node.groupPresentation === null || typeof node.groupPresentation === 'string') &&
        typeof node.available === 'boolean'
    )
  );
}
