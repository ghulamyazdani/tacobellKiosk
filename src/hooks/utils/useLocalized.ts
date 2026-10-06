import { useMemo } from "react";
import { useSelector } from "react-redux";
import { getTranslated } from "@cx-sdk/catalog/settings/settingsEngine";
import { selectSelectedLanguage } from "../../redux/features/multiLanguage/multiLanguage.slice";
import { isolate, isRtl } from "../../i18n";

/** The getPipelines fields a pipeline label reads. */
export interface PipelineLabel {
  primary_name?: string;
  secondary_name?: string;
  name?: string;
}

export interface Localized {
  /** The guest chose the deployment's secondary language (selectedLanguage.type, L0). */
  isSecondary: boolean;
  /** Menu entity name in the guest's language (the menu's `ar` alias), else `name`. */
  name(entity: unknown): string;
  /** Menu entity description, RAW: never isolated — its leaf <p> takes dir="auto". */
  description(entity: unknown): string;
  /** `secondary_name` in a secondary session when set, else `primary_name`, else `name`. */
  pipelineName(pipeline: PipelineLabel | null | undefined): string;
  /** Operator/data copy as is, isolated in RTL like a translated string. */
  text(value: string): string;
}

interface LanguageSlot {
  code?: string;
  type?: string;
}

const asText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

// Menu data is untrusted: a malformed alias entry (e.g. a non-string `code`)
// throws inside the `ar` lookup — show the plain field, never crash a render.
const translated = (code: string, entity: unknown, type: "TITLE" | "DESCRIPTION") => {
  try {
    return asText(getTranslated(code, entity, type));
  } catch {
    return asText(getTranslated("en", entity, type));
  }
};

/**
 * Menu and pipeline names in the guest's language, resolved at RENDER
 * (post-P9 item 28; the fork's getTranslated / getPipelineName).
 *
 * DISPLAY ONLY — never write a result into cart/order state, dispatch
 * payloads, addEntity args, analytics props, React keys or Dexie: the order
 * push, reporting and every lookup keep the primary-language `name`.
 *
 * In an RTL session every non-empty result except `description` is a
 * FSI…PDI isolate: BagItemRow puts a name and "+price" in one paragraph, and
 * an unisolated Arabic name pulls the price to its left (UBA W2/N1) — P9f
 * isolates every translated string and interpolated value, data names follow
 * the same rule. RTL comes from the REDUX code, never i18n.language (it
 * follows one render later). One selector: cheap inside every menu card.
 */
export default function useLocalized(): Localized {
  const language = useSelector(selectSelectedLanguage) as LanguageSlot | null | undefined;
  // `||` not `??`: a session reset blanks the code to "" (emptySelectedLanguage).
  const code = language?.code || "en";
  const isSecondary = language?.type === "secondary_language";

  return useMemo<Localized>(() => {
    const rtl = isRtl(code);
    const show = (s: string) => (rtl && s ? isolate(s) : s);
    return {
      isSecondary,
      name: (entity) => show(translated(code, entity, "TITLE")),
      description: (entity) => translated(code, entity, "DESCRIPTION"),
      pipelineName: (pipeline) =>
        show(
          (isSecondary && asText(pipeline?.secondary_name).trim()) ||
            asText(pipeline?.primary_name) ||
            asText(pipeline?.name),
        ),
      text: show,
    };
  }, [code, isSecondary]);
}
