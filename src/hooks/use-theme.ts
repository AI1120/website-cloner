"use client";

import { useEffect, useSyncExternalStore } from "react";

import { useHydrated, useStoredString } from "@/hooks/use-client";
import { isThemePreference, THEME_KEY, type ThemePreference } from "@/lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToScheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export interface Theme {
  /** What the person picked; "system" follows the device. */
  preference: ThemePreference;
  /** The theme in effect. Light while rendering on the server. */
  resolved: "light" | "dark";
  setPreference: (preference: ThemePreference) => void;
}

export function useTheme(): Theme {
  const [stored, setStored] = useStoredString(THEME_KEY);
  const systemDark = useSyncExternalStore(
    subscribeToScheme,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
  const preference = isThemePreference(stored) ? stored : "system";
  const resolved = preference === "dark" || (preference === "system" && systemDark) ? "dark" : "light";
  return { preference, resolved, setPreference: setStored };
}

/** Keeps the page's theme class in step with the preference, in every open tab. */
export function useApplyTheme(): void {
  const { resolved } = useTheme();
  // During hydration `resolved` is the server's guess; the head script already set the class.
  const hydrated = useHydrated();
  useEffect(() => {
    if (hydrated) document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [hydrated, resolved]);
}
