import * as React from "react";
import AnthropicMono from "@lobehub/icons/es/Anthropic/components/Mono.js";
import DeepSeekColor from "@lobehub/icons/es/DeepSeek/components/Color.js";
import GeminiColor from "@lobehub/icons/es/Gemini/components/Color.js";
import GrokMono from "@lobehub/icons/es/Grok/components/Mono.js";
import CohereColor from "@lobehub/icons/es/Cohere/components/Color.js";
import MetaColor from "@lobehub/icons/es/Meta/components/Color.js";
import MistralColor from "@lobehub/icons/es/Mistral/components/Color.js";
import NvidiaColor from "@lobehub/icons/es/Nvidia/components/Color.js";
import OpenAIMono from "@lobehub/icons/es/OpenAI/components/Mono.js";
import OpenCodeMono from "@lobehub/icons/es/OpenCode/components/Mono.js";
import QwenColor from "@lobehub/icons/es/Qwen/components/Color.js";
import ZhipuColor from "@lobehub/icons/es/Zhipu/components/Color.js";
import { BrainCircuit } from "lucide-react";

import { cn } from "@/lib/cn";

import { resolveModelBrand, type ModelBrand } from "./model-brand";

type BrandMarkProps = {
  size?: number | string;
  className?: string;
  "aria-hidden"?: boolean;
};

const BRAND_MARKS: Partial<Record<ModelBrand, React.ComponentType<BrandMarkProps>>> = {
  deepseek: DeepSeekColor,
  openai: OpenAIMono,
  anthropic: AnthropicMono,
  gemini: GeminiColor,
  qwen: QwenColor,
  zhipu: ZhipuColor,
  meta: MetaColor,
  llama: MetaColor,
  mistral: MistralColor,
  nvidia: NvidiaColor,
  grok: GrokMono,
  cohere: CohereColor,
  opencode: OpenCodeMono,
};

export { resolveModelBrand } from "./model-brand";

export function ModelBrandIcon({
  providerModelId,
  displayName,
  className,
  markSize = 16,
}: {
  providerModelId: string;
  displayName?: string;
  className?: string;
  markSize?: number | string;
}) {
  const brand = resolveModelBrand(providerModelId, { displayName });
  const BrandMark = BRAND_MARKS[brand];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full border border-border-subtle bg-inset",
        className,
      )}
    >
      {BrandMark ? (
        <BrandMark size={markSize} aria-hidden />
      ) : (
        <BrainCircuit size={markSize} className="text-fg-tertiary" aria-hidden />
      )}
    </span>
  );
}
