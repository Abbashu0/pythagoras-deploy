export const AI_MODEL_INPUT_MODALITIES = [
  "TEXT",
  "IMAGE",
  "VIDEO",
  "PDF",
] as const;

export type AIModelInputModality = (typeof AI_MODEL_INPUT_MODALITIES)[number];

/** Generation output is intentionally text-only in this Admin surface. */
export const AI_MODEL_OUTPUT_MODALITIES = ["TEXT"] as const;
export type AIModelOutputModality = (typeof AI_MODEL_OUTPUT_MODALITIES)[number];

export const AI_MODEL_MODALITY_LABELS: Record<
  AIModelInputModality,
  string
> = {
  TEXT: "نص",
  IMAGE: "صورة",
  VIDEO: "فيديو",
  PDF: "PDF",
};
