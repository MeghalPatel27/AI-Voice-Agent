/**
 * Hume EVI supplemental language-model selection.
 * Do not switch the live model without explicit user approval.
 */
export const HUME_EVI_SUPPORTED_MODELS = [
  "gpt-4o",
  "gpt-4.1",
  "gpt-4.1-mini",
  "claude-sonnet-4-20250514",
] as const;

export type HumeEviLanguageModel = (typeof HUME_EVI_SUPPORTED_MODELS)[number];

export const HUME_EVI_ACTIVE_LANGUAGE_MODEL: HumeEviLanguageModel = "gpt-4o";

export function getHumeEviLanguageModelConfig() {
  return {
    model_provider: "OPEN_AI" as const,
    model_resource: HUME_EVI_ACTIVE_LANGUAGE_MODEL,
    /**
     * Faster candidates exposed by Hume configs historically.
     * Listed for documentation only — not auto-applied.
     */
    fasterCandidatesDocumented: ["gpt-4.1-mini", "gpt-4.1"] as const,
  };
}
