/** Shared authoring contract. Compiler V1 preserves authored title/body bytes. */
export const INSTRUCTION_COMPILER_VERSION = 1 as const;
export const INSTRUCTION_LIMITS = Object.freeze({ sections: 24, title: 120, description: 480, bodyBytes: 32 * 1024, compiledBytes: 32 * 1024, authoringBytes: 48 * 1024 });
export interface InstructionSection { id: string; title: string; description: string; body: string; enabled: boolean }
export class InstructionSectionError extends Error {
  constructor(readonly field: string, message: string) { super(message); this.name = "InstructionSectionError"; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const instructionBytes = (text: string) => new TextEncoder().encode(text).length;
export function assertInstructionText(value: unknown, field: string, maxBytes: number): asserts value is string {
  if (typeof value !== "string" || !value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value) || instructionBytes(value) > maxBytes) {
    throw new InstructionSectionError(field, "النص يتجاوز الحد المسموح أو يحتوي محارف تحكّم غير صالحة.");
  }
}
export function validateInstructionSections(value: unknown, publication = false): InstructionSection[] {
  if (!Array.isArray(value) || value.length > INSTRUCTION_LIMITS.sections) throw new InstructionSectionError("sections", "الحد الأقصى 24 فقرة.");
  const ids = new Set<string>();
  const sections = value.map((entry, index) => {
    const field = `sections.${index}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "body,description,enabled,id,title") throw new InstructionSectionError(field, "حقول الفقرة غير صالحة.");
    if (Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null) throw new InstructionSectionError(field, "الفقرة يجب أن تكون سجلًا نصّيًا عاديًا.");
    const section = entry as InstructionSection;
    if (typeof section.id !== "string" || !uuid.test(section.id) || ids.has(section.id.toLowerCase())) throw new InstructionSectionError(field + ".id", "معرّفات الفقرات يجب أن تكون UUID فريدة.");
    ids.add(section.id.toLowerCase());
    if (typeof section.enabled !== "boolean") throw new InstructionSectionError(field + ".enabled", "حالة الفقرة غير صالحة.");
    assertInstructionText(section.title, field + ".title", INSTRUCTION_LIMITS.title * 4);
    assertInstructionText(section.description, field + ".description", INSTRUCTION_LIMITS.description * 4);
    assertInstructionText(section.body, field + ".body", INSTRUCTION_LIMITS.bodyBytes);
    if ([...section.title].length > INSTRUCTION_LIMITS.title || /[\r\n\t]/u.test(section.title)) throw new InstructionSectionError(field + ".title", "العنوان سطر واحد، بحد أقصى 120 محرفًا.");
    if ([...section.description].length > INSTRUCTION_LIMITS.description) throw new InstructionSectionError(field + ".description", "الوصف بحد أقصى 480 محرفًا.");
    if (publication && section.enabled && (!section.title.trim() || !section.body.trim())) throw new InstructionSectionError(field, "كل فقرة مفعّلة تحتاج عنوانًا ونصًا قبل النشر.");
    return { id: section.id, title: section.title, description: section.description, body: section.body, enabled: section.enabled };
  });
  if (instructionBytes(JSON.stringify(sections)) > INSTRUCTION_LIMITS.authoringBytes) throw new InstructionSectionError("sections", "حجم المسودة يتجاوز 48 KiB.");
  const compiled = compileInstructionSections(sections);
  if (instructionBytes(compiled.text) > INSTRUCTION_LIMITS.compiledBytes) throw new InstructionSectionError("sections", "النص التنفيذي يتجاوز 32 KiB.");
  if (publication && !sections.some((section) => section.enabled)) throw new InstructionSectionError("sections", "احتفظ بفقرة مفعّلة مكتملة؛ لإيقاف التعليمات عطّل السياسة كاملة.");
  return sections;
}
/** Each part owns its preceding separator; concatenating parts is the exact prompt. */
export function compileInstructionSections(sections: readonly InstructionSection[]) {
  let first = true;
  const parts = sections.map((section) => {
    const text = section.enabled ? `${first ? "" : "\n\n"}## ${section.title}\n${section.body}` : "";
    if (section.enabled) first = false;
    return { id: section.id, text };
  });
  return { version: INSTRUCTION_COMPILER_VERSION, text: parts.map((part) => part.text).join(""), parts };
}
export const instructionDraftKey = (sections: readonly InstructionSection[], enabled: boolean) => JSON.stringify({ enabled, sections });
/** Description is deliberately absent: metadata-only edits never trigger counting. */
export const instructionCountKey = (sections: readonly InstructionSection[]) => JSON.stringify(sections.map(({ id, title, body, enabled }) => ({ id, title, body, enabled })));
