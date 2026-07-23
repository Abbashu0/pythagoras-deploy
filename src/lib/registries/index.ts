/**
 * registries/index.ts
 * ===================
 * Global Registries for the Pythagoras Platform.
 *
 * No feature should hardcode values. Everything references registry IDs.
 *
 * Registries are stored in Firestore under the "registries" collection,
 * but these TypeScript constants provide type safety and default values
 * for the initial setup.
 *
 * When new values are needed, they're added to Firestore — not hardcoded.
 */

import type { RegistryEntry } from "@/lib/entities";

// ============================================================
// Subjects Registry
// ============================================================

export const SUBJECTS_REGISTRY: Omit<RegistryEntry, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">[] = [
  { registry: "subjects", key: "islamic", label: "التربية الإسلامية", englishLabel: "ISLAMIC", iconKey: "islamic", color: "#1a5c3a", order: 0, active: true },
  { registry: "subjects", key: "arabic", label: "اللغة العربية", englishLabel: "ARABIC", iconKey: "arabic", color: "#8b4513", order: 1, active: true },
  { registry: "subjects", key: "english", label: "اللغة الإنجليزية", englishLabel: "ENGLISH", iconKey: "english", color: "#1e3a8a", order: 2, active: true },
  { registry: "subjects", key: "biology", label: "الأحياء", englishLabel: "BIOLOGY", iconKey: "biology", color: "#166534", order: 3, active: true },
  { registry: "subjects", key: "math", label: "الرياضيات", englishLabel: "MATHEMATICS", iconKey: "math", color: "#7c2d12", order: 4, active: true },
  { registry: "subjects", key: "chemistry", label: "الكيمياء", englishLabel: "CHEMISTRY", iconKey: "chemistry", color: "#581c87", order: 5, active: true },
  { registry: "subjects", key: "physics", label: "الفيزياء", englishLabel: "PHYSICS", iconKey: "physics", color: "#0c4a6e", order: 6, active: true },
  { registry: "subjects", key: "french", label: "اللغة الفرنسية", englishLabel: "FRENCH", iconKey: "french", color: "#1e40af", order: 7, active: false },
];

// ============================================================
// Question Types Registry
// ============================================================

export const QUESTION_TYPES_REGISTRY: Omit<RegistryEntry, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">[] = [
  { registry: "question-types", key: "mcq", label: "اختيار من متعدد", englishLabel: "Multiple Choice", order: 0, active: true },
  { registry: "question-types", key: "fill-blank", label: "ملء الفراغ", englishLabel: "Fill in the Blank", order: 1, active: true },
  { registry: "question-types", key: "true-false", label: "صح أو خطأ", englishLabel: "True or False", order: 2, active: true },
  { registry: "question-types", key: "short-answer", label: "إجابة قصيرة", englishLabel: "Short Answer", order: 3, active: true },
  { registry: "question-types", key: "long-answer", label: "إجابة طويلة", englishLabel: "Long Answer", order: 4, active: true },
  { registry: "question-types", key: "essay", label: "مقال", englishLabel: "Essay", order: 5, active: true },
  { registry: "question-types", key: "matching", label: "تطابق", englishLabel: "Matching", order: 6, active: true },
  { registry: "question-types", key: "ordering", label: "ترتيب", englishLabel: "Ordering", order: 7, active: true },
  { registry: "question-types", key: "diagram", label: "رسم بياني", englishLabel: "Diagram", order: 8, active: true },
  { registry: "question-types", key: "custom", label: "مخصص", englishLabel: "Custom", order: 9, active: true },
];

// ============================================================
// Sources Registry
// ============================================================

export const SOURCES_REGISTRY: Omit<RegistryEntry, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">[] = [
  { registry: "sources", key: "ministerial", label: "وزاري", englishLabel: "Ministerial Exam", iconKey: "tests", order: 0, active: true },
  { registry: "sources", key: "educational-tv", label: "التلفزيون التعليمي", englishLabel: "Educational TV", iconKey: "video", order: 1, active: true },
  { registry: "sources", key: "chapter-end", label: "نهاية الفصل", englishLabel: "Chapter End", iconKey: "book", order: 2, active: true },
  { registry: "sources", key: "discussion", label: "مناقشة", englishLabel: "Discussion", iconKey: "message", order: 3, active: true },
  { registry: "sources", key: "enrichment", label: "إثراء", englishLabel: "Enrichment", iconKey: "sparkles", order: 4, active: true },
  { registry: "sources", key: "custom", label: "مخصص", englishLabel: "Custom", iconKey: "edit", order: 5, active: true },
];

// ============================================================
// Difficulty Levels Registry
// ============================================================

export const DIFFICULTY_REGISTRY: Omit<RegistryEntry, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">[] = [
  { registry: "difficulty", key: "easy", label: "سهل", englishLabel: "Easy", color: "#10b981", order: 0, active: true },
  { registry: "difficulty", key: "medium", label: "متوسط", englishLabel: "Medium", color: "#f59e0b", order: 1, active: true },
  { registry: "difficulty", key: "hard", label: "صعب", englishLabel: "Hard", color: "#ef4444", order: 2, active: true },
  { registry: "difficulty", key: "expert", label: "خبير", englishLabel: "Expert", color: "#7c3aed", order: 3, active: true },
];

// ============================================================
// Resource Types Registry
// ============================================================

export const RESOURCE_TYPES_REGISTRY: Omit<RegistryEntry, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">[] = [
  { registry: "resource-types", key: "image", label: "صورة", englishLabel: "Image", iconKey: "image", order: 0, active: true },
  { registry: "resource-types", key: "drawing", label: "رسم", englishLabel: "Drawing", iconKey: "pen", order: 1, active: true },
  { registry: "resource-types", key: "svg", label: "SVG", englishLabel: "SVG Vector", iconKey: "grid", order: 2, active: true },
  { registry: "resource-types", key: "table", label: "جدول", englishLabel: "Table", iconKey: "list", order: 3, active: true },
  { registry: "resource-types", key: "audio", label: "صوت", englishLabel: "Audio", iconKey: "music", order: 4, active: true },
  { registry: "resource-types", key: "video", label: "فيديو", englishLabel: "Video", iconKey: "video", order: 5, active: true },
  { registry: "resource-types", key: "pdf", label: "PDF", englishLabel: "PDF Document", iconKey: "file-text", order: 6, active: true },
  { registry: "resource-types", key: "animation", label: "حركة", englishLabel: "Animation", iconKey: "zap", order: 7, active: true },
  { registry: "resource-types", key: "interactive", label: "تفاعلي", englishLabel: "Interactive", iconKey: "play-circle", order: 8, active: true },
  { registry: "resource-types", key: "custom", label: "مخصص", englishLabel: "Custom", iconKey: "settings", order: 9, active: true },
];

// ============================================================
// Branches Registry (Scientific vs Literary)
// ============================================================

export const BRANCHES_REGISTRY: Omit<RegistryEntry, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">[] = [
  { registry: "branches", key: "scientific", label: "علمي", englishLabel: "Scientific", order: 0, active: true },
  { registry: "branches", key: "literary", label: "أدبي", englishLabel: "Literary", order: 1, active: true },
  { registry: "branches", key: "common", label: "مشترك", englishLabel: "Common", order: 2, active: true },
];

// ============================================================
// Exam Sessions Registry
// ============================================================

export const EXAM_SESSIONS_REGISTRY: Omit<RegistryEntry, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">[] = [
  { registry: "exam-sessions", key: "first", label: "الدورة الأولى", englishLabel: "First Session", order: 0, active: true },
  { registry: "exam-sessions", key: "second", label: "الدورة الثانية", englishLabel: "Second Session", order: 1, active: true },
];

// ============================================================
// Languages Registry
// ============================================================

export const LANGUAGES_REGISTRY: Omit<RegistryEntry, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">[] = [
  { registry: "languages", key: "ar", label: "العربية", englishLabel: "Arabic", order: 0, active: true },
  { registry: "languages", key: "en", label: "الإنجليزية", englishLabel: "English", order: 1, active: true },
  { registry: "languages", key: "fr", label: "الفرنسية", englishLabel: "French", order: 2, active: true },
];

// ============================================================
// Package Status Registry
// ============================================================

export const PACKAGE_STATUS_REGISTRY: Omit<RegistryEntry, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">[] = [
  { registry: "package-status", key: "draft", label: "مسودة", englishLabel: "Draft", color: "#6b7280", order: 0, active: true },
  { registry: "package-status", key: "review", label: "مراجعة", englishLabel: "Review", color: "#f59e0b", order: 1, active: true },
  { registry: "package-status", key: "ready", label: "جاهز", englishLabel: "Ready", color: "#3b82f6", order: 2, active: true },
  { registry: "package-status", key: "published", label: "منشور", englishLabel: "Published", color: "#10b981", order: 3, active: true },
  { registry: "package-status", key: "archived", label: "مؤرشف", englishLabel: "Archived", color: "#6b7280", order: 4, active: true },
  { registry: "package-status", key: "hidden", label: "مخفي", englishLabel: "Hidden", color: "#ef4444", order: 5, active: true },
];

// ============================================================
// Helper: get all registries as a single array
// ============================================================

export const ALL_REGISTRIES = [
  ...SUBJECTS_REGISTRY,
  ...QUESTION_TYPES_REGISTRY,
  ...SOURCES_REGISTRY,
  ...DIFFICULTY_REGISTRY,
  ...RESOURCE_TYPES_REGISTRY,
  ...BRANCHES_REGISTRY,
  ...EXAM_SESSIONS_REGISTRY,
  ...LANGUAGES_REGISTRY,
  ...PACKAGE_STATUS_REGISTRY,
];

// ============================================================
// Helper: lookup functions
// ============================================================

export function getRegistryLabel(registry: string, key: string): string {
  const entry = ALL_REGISTRIES.find((r) => r.registry === registry && r.key === key);
  return entry?.label || key;
}

export function getRegistryColor(registry: string, key: string): string | undefined {
  const entry = ALL_REGISTRIES.find((r) => r.registry === registry && r.key === key);
  return entry?.color;
}

export function getRegistryEntries(registry: string): Omit<RegistryEntry, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">[] {
  return ALL_REGISTRIES.filter((r) => r.registry === registry);
}
