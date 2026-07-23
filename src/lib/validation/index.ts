/**
 * validation/index.ts
 * ===================
 * Validation architecture for the Pythagoras Platform.
 *
 * Every entity must validate itself before being saved.
 * Validation produces structured reports — not just true/false.
 *
 * Usage:
 *   const report = validateQuestion(question);
 *   if (!report.valid) {
 *     console.log(report.errors);
 *   }
 */

import type {
  Question,
  Package,
  Resource,
  Subject,
  Section,
  Topic,
} from "@/lib/entities";

// ============================================================
// Types
// ============================================================

export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
  code: string;
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  warningsCount: number;
  errorsCount: number;
}

// ============================================================
// Helpers
// ============================================================

function createReport(errors: ValidationError[]): ValidationReport {
  const realErrors = errors.filter((e) => e.severity === "error");
  const warnings = errors.filter((e) => e.severity === "warning");
  return {
    valid: realErrors.length === 0,
    errors: realErrors,
    warnings,
    warningsCount: warnings.length,
    errorsCount: realErrors.length,
  };
}

function field(message: string, field: string, code: string, severity: "error" | "warning" = "error"): ValidationError {
  return { field, message, severity, code };
}

function required(value: unknown, fieldName: string): ValidationError | null {
  if (value === undefined || value === null || value === "") {
    return field(`الحقل مطلوب: ${fieldName}`, fieldName, "REQUIRED");
  }
  return null;
}

function minLength(value: string, min: number, fieldName: string): ValidationError | null {
  if (value && value.length < min) {
    return field(`يجب أن يكون ${fieldName} على الأقل ${min} أحرف`, fieldName, "MIN_LENGTH");
  }
  return null;
}

// ============================================================
// Subject Validation
// ============================================================

export function validateSubject(subject: Partial<Subject>): ValidationReport {
  const errors: ValidationError[] = [];

  const nameErr = required(subject.name, "الاسم");
  if (nameErr) errors.push(nameErr);

  const englishErr = required(subject.englishName, "الاسم الإنجليزي");
  if (englishErr) errors.push(englishErr);

  const iconErr = required(subject.iconKey, "الأيقونة");
  if (iconErr) errors.push(iconErr);

  const colorErr = required(subject.color, "اللون");
  if (colorErr) errors.push(colorErr);

  return createReport(errors);
}

// ============================================================
// Section Validation
// ============================================================

export function validateSection(section: Partial<Section>): ValidationReport {
  const errors: ValidationError[] = [];

  const nameErr = required(section.name, "الاسم");
  if (nameErr) errors.push(nameErr);

  const subjectErr = required(section.subjectId, "المادة");
  if (subjectErr) errors.push(subjectErr);

  return createReport(errors);
}

// ============================================================
// Topic Validation
// ============================================================

export function validateTopic(topic: Partial<Topic>): ValidationReport {
  const errors: ValidationError[] = [];

  const nameErr = required(topic.name, "الاسم");
  if (nameErr) errors.push(nameErr);

  const sectionErr = required(topic.sectionId, "القسم");
  if (sectionErr) errors.push(sectionErr);

  return createReport(errors);
}

// ============================================================
// Package Validation
// ============================================================

export function validatePackage(pkg: Partial<Package>): ValidationReport {
  const errors: ValidationError[] = [];

  const nameErr = required(pkg.name, "الاسم");
  if (nameErr) errors.push(nameErr);

  const subjectErr = required(pkg.subjectId, "المادة");
  if (subjectErr) errors.push(subjectErr);

  const sectionErr = required(pkg.sectionId, "القسم");
  if (sectionErr) errors.push({ ...sectionErr, severity: "warning" as const });

  // Warnings
  if (pkg.questionCount === 0) {
    errors.push(field("الحزمة لا تحتوي على أسئلة", "questionCount", "EMPTY_PACKAGE", "warning"));
  }

  if (pkg.status === "published" && pkg.questionCount === 0) {
    errors.push(field("لا يمكن نشر حزمة بدون أسئلة", "status", "PUBLISH_EMPTY"));
  }

  return createReport(errors);
}

// ============================================================
// Question Validation
// ============================================================

export function validateQuestion(question: Partial<Question>): ValidationReport {
  const errors: ValidationError[] = [];

  // Required fields
  const textErr = required(question.questionText, "نص السؤال");
  if (textErr) errors.push(textErr);

  const answerErr = required(question.answerText, "الإجابة");
  if (answerErr) errors.push(answerErr);

  const typeErr = required(question.type, "نوع السؤال");
  if (typeErr) errors.push(typeErr);

  const packageErr = required(question.packageId, "الحزمة");
  if (packageErr) errors.push(packageErr);

  const subjectErr = required(question.subjectId, "المادة");
  if (subjectErr) errors.push(subjectErr);

  // MCQ-specific validation
  if (question.type === "mcq") {
    if (!question.options || question.options.length < 2) {
      errors.push(field("الاختيار من متعدد يتطلب خيارين على الأقل", "options", "MCQ_MIN_OPTIONS"));
    }
    if (question.correctOptionIndex === undefined || question.correctOptionIndex === null) {
      errors.push(field("يجب تحديد الإجابة الصحيحة", "correctOptionIndex", "MCQ_NO_CORRECT"));
    }
    if (question.options && question.correctOptionIndex !== undefined) {
      if (question.correctOptionIndex >= question.options.length) {
        errors.push(field("فهرس الإجابة الصحيحة خارج النطاق", "correctOptionIndex", "MCQ_INDEX_OUT_OF_RANGE"));
      }
    }
  }

  // Warnings
  if (!question.tags || question.tags.length === 0) {
    errors.push(field("لا توجد وسوم لهذا السؤال", "tags", "NO_TAGS", "warning"));
  }

  if (!question.appearances || question.appearances.length === 0) {
    errors.push(field("لا توجد مصادر لهذا السؤال", "appearances", "NO_SOURCES", "warning"));
  }

  if (!question.explanation) {
    errors.push(field("لا يوجد شرح للإجابة", "explanation", "NO_EXPLANATION", "warning"));
  }

  return createReport(errors);
}

// ============================================================
// Resource Validation
// ============================================================

export function validateResource(resource: Partial<Resource>): ValidationReport {
  const errors: ValidationError[] = [];

  const nameErr = required(resource.name, "الاسم");
  if (nameErr) errors.push(nameErr);

  const typeErr = required(resource.type, "النوع");
  if (typeErr) errors.push(typeErr);

  const pathErr = required(resource.storagePath, "مسار التخزين");
  if (pathErr) errors.push(pathErr);

  const mimeErr = required(resource.mimeType, "نوع MIME");
  if (mimeErr) errors.push(mimeErr);

  // Warnings
  if (!resource.altText) {
    errors.push(field("لا يوجد نص بديل (alt text) للصورة", "altText", "NO_ALT_TEXT", "warning"));
  }

  if (resource.sizeBytes > 5 * 1024 * 1024) {
    errors.push(field("حجم الملف كبير (>5MB)", "sizeBytes", "LARGE_FILE", "warning"));
  }

  return createReport(errors);
}

// ============================================================
// Batch validation
// ============================================================

export function validateQuestions(questions: Partial<Question>[]): ValidationReport {
  const allErrors: ValidationError[] = [];
  for (let i = 0; i < questions.length; i++) {
    const report = validateQuestion(questions[i]);
    if (!report.valid) {
      for (const err of report.errors) {
        allErrors.push({
          ...err,
          field: `question[${i}].${err.field}`,
          message: `السؤال ${i + 1}: ${err.message}`,
        });
      }
    }
  }
  return createReport(allErrors);
}

export function validatePackageContents(pkg: Partial<Package>, questions: Partial<Question>[]): ValidationReport {
  const pkgReport = validatePackage(pkg);
  const questionsReport = validateQuestions(questions);

  return createReport([...pkgReport.errors, ...questionsReport.errors]);
}
