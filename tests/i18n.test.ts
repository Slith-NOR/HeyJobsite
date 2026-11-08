import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { es } from "@/i18n/es";
import { ht } from "@/i18n/ht";
import { errorMessage, t } from "@/i18n";

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe("translations", () => {
  it("Spanish and Haitian Creole cover every key with the same placeholders", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      for (const dict of [es, ht]) {
        expect(dict[key], key).toBeTruthy();
        expect(placeholders(dict[key]), key).toEqual(placeholders(en[key]));
      }
    }
  });

  it("interpolates and falls back for unknown error codes", () => {
    expect(t("ht", "home.welcome", { name: "John" })).toContain("John");
    expect(errorMessage("es", "engagement_cycle")).toBe(es["error.engagement_cycle"]);
    expect(errorMessage("en", "something_new")).toBe(en["error.generic"]);
  });
});
