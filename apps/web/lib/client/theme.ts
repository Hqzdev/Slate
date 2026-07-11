export type SlateTheme = "dark" | "light";

export const slateThemeStorageKey = "slate-workspace-theme";
export const slateThemeChangeEvent = "slate-theme-change";

export function getSystemTheme(): SlateTheme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function getStoredTheme(): SlateTheme | null {
  const storedTheme = window.localStorage.getItem(slateThemeStorageKey);
  return storedTheme === "light" || storedTheme === "dark" ? storedTheme : null;
}

export function getResolvedTheme(): SlateTheme {
  return getStoredTheme() ?? getSystemTheme();
}

export function getServerThemeSnapshot(): SlateTheme {
  return "light";
}

export function applyTheme(theme: SlateTheme) {
  document.documentElement.dataset.theme = theme;
}

export function setThemePreference(theme: SlateTheme) {
  window.localStorage.setItem(slateThemeStorageKey, theme);
  applyTheme(theme);
  window.dispatchEvent(new Event(slateThemeChangeEvent));
}

export function subscribeThemeChange(callback: () => void) {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
  const handleStorage = (event: StorageEvent) => {
    if (event.key === slateThemeStorageKey) callback();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(slateThemeChangeEvent, callback);
  mediaQuery.addEventListener("change", callback);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(slateThemeChangeEvent, callback);
    mediaQuery.removeEventListener("change", callback);
  };
}
