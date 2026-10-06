import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../../redux/app/store";
import {
  emptySelectedLanguage,
  setSelectedLanguage,
} from "../../../redux/features/multiLanguage/multiLanguage.slice";
import i18n from "../../../i18n";
import useLocalized from "../useLocalized";

/*
  Post-P9 28 — names are resolved at RENDER. In an RTL session every non-empty
  name / pipelineName / text is one FSI…PDI isolate (a name and "+price" share
  a paragraph in the bag); description stays raw (its leaf <p> takes
  dir="auto"). RTL comes from the REDUX code, never i18n.language, and
  English output is byte-identical to the data.
*/

const FSI = "⁨";
const PDI = "⁩";
const iso = (s: string) => `${FSI}${s}${PDI}`;
const ISOLATES = /[⁦-⁩]/;

const AR_NAME = "تشيز برجر";
const AR_DESCRIPTION = "برجر بالجبن";
const AR_PIPELINE = "تناول في المطعم";

const AR_SESSION = { name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" };
const EN_SESSION = { name: "English", code: "en", dir: "ltr", type: "primary_language" };
const HI_SESSION = { name: "Hindi", code: "hi", dir: "ltr", type: "secondary_language" };

const BURGER = {
  id: "cb",
  name: "Cheese Burger",
  description: "A cheesy classic",
  aliases: [{ value: AR_NAME, name: "Arabic", code: "ar", dir: "rtl" }],
  _extra: { descriptionTranslation: AR_DESCRIPTION },
};
const PIPELINE = { primary_name: "Dine In", secondary_name: AR_PIPELINE };

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);
const localized = () => renderHook(() => useLocalized(), { wrapper });

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("useLocalized — the three sessions", () => {
  it("Arabic secondary {code:'ar', type:'secondary_language'}: alias, translated description, secondary pipeline name", () => {
    store.dispatch(setSelectedLanguage(AR_SESSION));
    const { result } = localized();

    expect(result.current.isSecondary).toBe(true);
    expect(result.current.name(BURGER)).toBe(iso(AR_NAME));
    expect(result.current.description(BURGER)).toBe(AR_DESCRIPTION);
    expect(result.current.pipelineName(PIPELINE)).toBe(iso(AR_PIPELINE));
    expect(result.current.text("HAPPY")).toBe(iso("HAPPY"));
  });

  it("English: the plain fields, byte-identical — no isolate anywhere", () => {
    store.dispatch(setSelectedLanguage(EN_SESSION));
    const { result } = localized();

    expect(result.current.isSecondary).toBe(false);
    expect(result.current.name(BURGER)).toBe("Cheese Burger");
    expect(result.current.description(BURGER)).toBe("A cheesy classic");
    expect(result.current.pipelineName(PIPELINE)).toBe("Dine In");
    expect(result.current.text("HAPPY")).toBe("HAPPY");
  });

  it("a reset '' (emptySelectedLanguage) reads as English primary", () => {
    store.dispatch(setSelectedLanguage(AR_SESSION));
    store.dispatch(emptySelectedLanguage());
    const { result } = localized();

    expect(result.current.isSecondary).toBe(false);
    expect(result.current.name(BURGER)).toBe("Cheese Burger");
    expect(result.current.description(BURGER)).toBe("A cheesy classic");
    expect(result.current.pipelineName(PIPELINE)).toBe("Dine In");
  });
});

describe("useLocalized — isolates", () => {
  it("are decided from the REDUX code even while i18n is still 'en'", () => {
    expect(i18n.language).toBe("en");
    store.dispatch(setSelectedLanguage(AR_SESSION));
    const { result } = localized();

    expect(result.current.name(BURGER)).toBe(iso(AR_NAME));
    expect(result.current.name({ name: "Plain" })).toBe(iso("Plain")); // no alias: English, still isolated
  });

  it("never appear for an English redux code, even while i18n is 'ar'", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    store.dispatch(setSelectedLanguage(EN_SESSION));
    const { result } = localized();

    expect(result.current.name(BURGER)).toBe("Cheese Burger");
    expect(result.current.text("HAPPY")).toBe("HAPPY");
    expect(result.current.pipelineName(PIPELINE)).not.toMatch(ISOLATES);
  });

  it("never appear for a reset '' code, even while i18n is still 'ar' (the '' must not fall through to i18n.language)", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    store.dispatch(setSelectedLanguage(AR_SESSION));
    store.dispatch(emptySelectedLanguage());
    const { result } = localized();

    expect(result.current.name(BURGER)).toBe("Cheese Burger");
    expect(result.current.text("HAPPY")).toBe("HAPPY");
    expect(result.current.pipelineName(PIPELINE)).toBe("Dine In");
  });

  it("an empty result is never wrapped", () => {
    store.dispatch(setSelectedLanguage(AR_SESSION));
    const { result } = localized();

    expect(result.current.name(null)).toBe("");
    expect(result.current.name({})).toBe("");
    expect(result.current.pipelineName(null)).toBe("");
    expect(result.current.text("")).toBe("");
  });

  it("description is never isolated, in any session", () => {
    store.dispatch(setSelectedLanguage(AR_SESSION));
    const { result } = localized();

    expect(result.current.description(BURGER)).not.toMatch(ISOLATES);
    expect(result.current.description({ description: "Only English" })).toBe("Only English");
  });
});

describe("useLocalized — pipeline names", () => {
  it("a blank secondary_name falls back to primary_name (then to the legacy name)", () => {
    store.dispatch(setSelectedLanguage(AR_SESSION));
    const { result } = localized();

    expect(result.current.pipelineName({ primary_name: "Dine In", secondary_name: "   " })).toBe(iso("Dine In"));
    expect(result.current.pipelineName({ primary_name: "Dine In" })).toBe(iso("Dine In"));
    expect(result.current.pipelineName({ name: "Legacy" })).toBe(iso("Legacy"));
  });

  it("a secondary_name is trimmed", () => {
    store.dispatch(setSelectedLanguage(AR_SESSION));
    const { result } = localized();

    expect(result.current.pipelineName({ primary_name: "Dine In", secondary_name: ` ${AR_PIPELINE} ` })).toBe(
      iso(AR_PIPELINE),
    );
  });

  it("a primary session never reads secondary_name — even with an Arabic code", () => {
    store.dispatch(setSelectedLanguage({ ...AR_SESSION, type: "primary_language" }));
    const { result } = localized();

    expect(result.current.isSecondary).toBe(false);
    expect(result.current.pipelineName(PIPELINE)).toBe(iso("Dine In"));
    expect(result.current.name(BURGER)).toBe(iso(AR_NAME)); // item names follow the code
  });
});

describe("useLocalized — a non-ar secondary language ('hi')", () => {
  it("keeps English item names (getTranslated is ar-only) but uses secondary_name, LTR", () => {
    store.dispatch(setSelectedLanguage(HI_SESSION));
    const { result } = localized();

    expect(result.current.isSecondary).toBe(true);
    expect(result.current.name(BURGER)).toBe("Cheese Burger");
    expect(result.current.description(BURGER)).toBe("A cheesy classic");
    expect(result.current.pipelineName({ primary_name: "Dine In", secondary_name: "Andar" })).toBe("Andar");
    expect(result.current.text("HAPPY")).toBe("HAPPY");
  });
});

describe("useLocalized — untrusted data never crashes a render", () => {
  it("map-shaped aliases or a non-string alias code fall back to the plain name", () => {
    store.dispatch(setSelectedLanguage(AR_SESSION));
    const { result } = localized();

    expect(result.current.name({ name: "Mapped", aliases: { ar: AR_NAME } })).toBe(iso("Mapped"));
    expect(result.current.name({ name: "NumCode", aliases: [{ code: 7, value: AR_NAME }] })).toBe(iso("NumCode"));
  });

  it("non-string fields become '' (numbers are kept as text)", () => {
    const { result } = localized();

    expect(result.current.name({ name: 5 })).toBe("5");
    expect(result.current.name({ name: { x: 1 } })).toBe("");
    expect(result.current.pipelineName({ primary_name: 7 as unknown as string })).toBe("7");
  });
});

describe("useLocalized — memo identity", () => {
  it("is stable across renders and unrelated store writes until the language changes", () => {
    const { result, rerender } = localized();
    const first = result.current;

    rerender();
    act(() => {
      store.dispatch({ type: "unrelated/write" });
    });
    expect(result.current).toBe(first);

    act(() => {
      store.dispatch(setSelectedLanguage(AR_SESSION));
    });
    const arabic = result.current;
    expect(arabic).not.toBe(first);
    expect(arabic.name(BURGER)).toBe(iso(AR_NAME));

    act(() => {
      store.dispatch(setSelectedLanguage({ ...AR_SESSION })); // a new object, same code and slot
    });
    expect(result.current).toBe(arabic);

    act(() => {
      store.dispatch(setSelectedLanguage(EN_SESSION));
    });
    expect(result.current).not.toBe(arabic);
    expect(result.current.name(BURGER)).toBe("Cheese Burger");
  });
});
