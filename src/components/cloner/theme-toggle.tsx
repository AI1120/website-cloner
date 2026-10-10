"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApplyTheme, useTheme } from "@/hooks/use-theme";
import { isThemePreference, type ThemePreference } from "@/lib/theme";

export const THEME_LABELS: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "Match the device",
};

export const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } satisfies Record<
  ThemePreference,
  unknown
>;

export function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme();
  const Icon = resolved === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Theme" title="Theme" />}
      >
        <Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value: unknown) => {
            if (isThemePreference(value)) setPreference(value);
          }}
        >
          {(Object.keys(THEME_LABELS) as ThemePreference[]).map((value) => {
            const ItemIcon = THEME_ICONS[value];
            return (
              <DropdownMenuRadioItem key={value} value={value}>
                <ItemIcon />
                {THEME_LABELS[value]}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Applies the chosen theme to the page. Rendered once, in the root layout. */
export function ThemeSync() {
  useApplyTheme();
  return null;
}
