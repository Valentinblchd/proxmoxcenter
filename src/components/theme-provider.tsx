"use client";

import { useEffect } from "react";
import {
  APP_THEME_BG_BLUR_STORAGE_KEY,
  APP_THEME_BG_IMAGE_STORAGE_KEY,
  APP_THEME_BG_POSITION_X_STORAGE_KEY,
  APP_THEME_BG_POSITION_Y_STORAGE_KEY,
  APP_THEME_BG_SCALE_STORAGE_KEY,
  APP_THEME_STORAGE_KEY,
  DEFAULT_APP_THEME,
  isAppThemeId,
  normalizeThemeBackgroundBlur,
  normalizeThemeBackgroundPosition,
  normalizeThemeBackgroundScale,
} from "@/lib/ui/themes";

export default function ThemeProvider() {
  useEffect(() => {
    const root = document.documentElement;
    const applyStoredTheme = () => {
      try {
        const stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
        const image = window.localStorage.getItem(APP_THEME_BG_IMAGE_STORAGE_KEY) || "";
        const blurRaw = window.localStorage.getItem(APP_THEME_BG_BLUR_STORAGE_KEY);
        const positionXRaw = window.localStorage.getItem(APP_THEME_BG_POSITION_X_STORAGE_KEY);
        const positionYRaw = window.localStorage.getItem(APP_THEME_BG_POSITION_Y_STORAGE_KEY);
        const scaleRaw = window.localStorage.getItem(APP_THEME_BG_SCALE_STORAGE_KEY);
        const safeBlur = normalizeThemeBackgroundBlur(Number.parseInt(blurRaw || "12", 10));
        const safePositionX = normalizeThemeBackgroundPosition(Number.parseInt(positionXRaw || "50", 10));
        const safePositionY = normalizeThemeBackgroundPosition(Number.parseInt(positionYRaw || "50", 10));
        const safeScale = normalizeThemeBackgroundScale(Number.parseInt(scaleRaw || "108", 10));
        root.dataset.theme = isAppThemeId(stored) ? stored : DEFAULT_APP_THEME;
        root.style.setProperty("--app-bg-image", image ? `url("${image.replace(/"/g, "%22")}")` : "none");
        root.style.setProperty("--app-bg-blur", `${safeBlur}px`);
        root.style.setProperty("--app-bg-position-x", String(safePositionX));
        root.style.setProperty("--app-bg-position-y", String(safePositionY));
        root.style.setProperty("--app-bg-scale", String(safeScale));
        root.style.setProperty(
          "--app-bg-image-opacity",
          root.dataset.theme === "photo" && image ? "0.46" : "0",
        );
      } catch {
        root.dataset.theme = DEFAULT_APP_THEME;
        root.style.setProperty("--app-bg-image", "none");
        root.style.setProperty("--app-bg-blur", "12px");
        root.style.setProperty("--app-bg-position-x", "50");
        root.style.setProperty("--app-bg-position-y", "50");
        root.style.setProperty("--app-bg-scale", "108");
        root.style.setProperty("--app-bg-image-opacity", "0");
      }
    };

    applyStoredTheme();
    window.addEventListener("storage", applyStoredTheme);
    window.addEventListener("proxmoxcenter:theme-change", applyStoredTheme);
    return () => {
      window.removeEventListener("storage", applyStoredTheme);
      window.removeEventListener("proxmoxcenter:theme-change", applyStoredTheme);
    };
  }, []);

  return null;
}
