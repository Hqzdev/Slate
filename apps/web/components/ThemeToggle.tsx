"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "@/components/Icons";
import { getResolvedTheme, getServerThemeSnapshot, setThemePreference, subscribeThemeChange } from "@/lib/client/theme";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeThemeChange, getResolvedTheme, getServerThemeSnapshot);
  const nextTheme = theme === "light" ? "dark" : "light";
  const Icon = theme === "light" ? MoonIcon : SunIcon;

  return (
    <button className="theme-toggle-button" aria-label={`Switch to ${nextTheme} theme`} onClick={() => setThemePreference(nextTheme)} title={`Switch to ${nextTheme} theme`} type="button">
      <Icon />
    </button>
  );
}
