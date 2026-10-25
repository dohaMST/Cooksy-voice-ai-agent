import { useEffect } from "react";
import { useLocal } from "@/lib/settings/store";

/**
 * Accent options are ember-first: the brand colour is the default, and the rest
 * are tints that keep the same warm ramp rather than fighting it.
 */
export const ACCENTS = {
  ember: { label: "Ember", color: "oklch(0.775 0.155 62)" },
  honey: { label: "Honey", color: "oklch(0.83 0.145 85)" },
  chili: { label: "Chili", color: "oklch(0.7 0.19 32)" },
  sage: { label: "Sage", color: "oklch(0.78 0.1 145)" },
  ocean: { label: "Ocean", color: "oklch(0.76 0.11 220)" },
} as const;
export type Accent = keyof typeof ACCENTS;

export const BACKGROUNDS = { ember: "Ember", dusk: "Dusk", sand: "Sand", room: "Studio" } as const;
export type Background = keyof typeof BACKGROUNDS;
export type ThemeSettings = {
  accent: Accent;
  blur: number;
  glass: number;
  radius: number;
  background: Background;
};
export const THEME_KEY = "openclaw.theme";
export const DEFAULT_THEME: ThemeSettings = {
  accent: "ember",
  blur: 24,
  glass: 58,
  radius: 24,
  background: "ember",
};
export const THEME_LIMITS = { blur: [0, 40], glass: [20, 95], radius: [6, 32] } as const;

export function useTheme() {
  return useLocal<ThemeSettings>(THEME_KEY, DEFAULT_THEME);
}

/**
 * Unknown stored values fall back to the current brand, so a browser holding
 * the retired green accent lands on ember instead of a half-applied theme.
 */
export function clampTheme(t: ThemeSettings): ThemeSettings {
  const c = (v: number, [lo, hi]: readonly [number, number]) =>
    Math.min(hi, Math.max(lo, Math.round(v)));
  return {
    accent: t.accent in ACCENTS ? t.accent : DEFAULT_THEME.accent,
    background: t.background in BACKGROUNDS ? t.background : DEFAULT_THEME.background,
    blur: c(t.blur, THEME_LIMITS.blur),
    glass: c(t.glass, THEME_LIMITS.glass),
    radius: c(t.radius, THEME_LIMITS.radius),
  };
}

/** Writes the theme into the page's design tokens so every surface updates live. */
export function useApplyTheme() {
  const [theme] = useTheme();
  useEffect(() => {
    const t = clampTheme(theme);
    const root = document.documentElement.style;
    document.documentElement.dataset["background"] = t.background;
    // Only the base ember is written: bright/deep are mixed from it in CSS, so
    // one property retints buttons, glows, borders and the WebGL field together.
    root.setProperty("--dc-ember", ACCENTS[t.accent].color);
    root.setProperty("--glass-blur", `${t.blur}px`);
    root.setProperty("--glass-alpha", `${t.glass}%`);
    root.setProperty("--theme-radius", `${t.radius}px`);
  }, [theme]);
}
