"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const STORAGE_EVENT = "sitecloner:storage";

function subscribeToNothing(): () => void {
  return () => {};
}

/** False while rendering on the server and during hydration, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

/** The current time, refreshed on an interval. Null until the page has mounted. */
export function useNow(intervalMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(STORAGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORAGE_EVENT, onChange);
  };
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
    return null;
  }
}

/** A text preference remembered in this browser; null until one is stored. */
export function useStoredString(key: string): [string | null, (value: string) => void] {
  const stored = useSyncExternalStore(
    subscribeToStorage,
    () => readStorage(key),
    () => null,
  );
  const set = useCallback(
    (value: string) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // The preference just won't be remembered.
      }
      window.dispatchEvent(new Event(STORAGE_EVENT));
    },
    [key],
  );
  return [stored, set];
}

/** An on/off preference remembered in this browser. */
export function useStoredFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [stored, setStored] = useStoredString(key);
  const set = useCallback((value: boolean) => setStored(value ? "1" : "0"), [setStored]);
  return [stored === null ? fallback : stored === "1", set];
}
