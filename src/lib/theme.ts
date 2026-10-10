export type ThemePreference = "light" | "dark" | "system";

export const THEME_KEY = "sitecloner:theme";

export const THEME_PREFERENCES: ThemePreference[] = ["light", "dark", "system"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Runs in <head> before the page paints, so a dark theme never flashes light.
 * Keep it in step with how `useTheme` resolves the preference.
 */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_KEY)});var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})();`;
