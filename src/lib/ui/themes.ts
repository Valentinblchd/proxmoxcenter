export const APP_THEME_STORAGE_KEY = "proxmoxcenter_theme";
export const APP_THEME_BG_IMAGE_STORAGE_KEY = "proxmoxcenter_theme_bg_image";
export const APP_THEME_BG_BLUR_STORAGE_KEY = "proxmoxcenter_theme_bg_blur";
export const APP_THEME_BG_POSITION_X_STORAGE_KEY = "proxmoxcenter_theme_bg_position_x";
export const APP_THEME_BG_POSITION_Y_STORAGE_KEY = "proxmoxcenter_theme_bg_position_y";
export const APP_THEME_BG_SCALE_STORAGE_KEY = "proxmoxcenter_theme_bg_scale";

export type AppThemeId = "current" | "dark" | "blue" | "light" | "green" | "slate" | "photo";

export type AppThemeDefinition = {
  id: AppThemeId;
  label: string;
  hint: string;
};

export const APP_THEMES: AppThemeDefinition[] = [
  {
    id: "current",
    label: "Orange nuit",
    hint: "Palette principale actuelle.",
  },
  {
    id: "dark",
    label: "Sombre",
    hint: "Graphite dense, plus neutre.",
  },
  {
    id: "blue",
    label: "Bleu",
    hint: "Accent froid orienté exploitation.",
  },
  {
    id: "light",
    label: "Clair",
    hint: "Fond lumineux pour usage de jour.",
  },
  {
    id: "green",
    label: "Vert",
    hint: "Accent émeraude pour exploitation.",
  },
  {
    id: "slate",
    label: "Ardoise",
    hint: "Neutre froid plus sobre.",
  },
  {
    id: "photo",
    label: "Image",
    hint: "Fond personnalisé.",
  },
];

export const DEFAULT_APP_THEME: AppThemeId = "current";

export function normalizeThemeBackgroundBlur(value: number) {
  if (!Number.isFinite(value)) return 12;
  return Math.max(0, Math.min(24, Math.round(value)));
}

export function normalizeThemeBackgroundPosition(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeThemeBackgroundScale(value: number) {
  if (!Number.isFinite(value)) return 108;
  return Math.max(100, Math.min(180, Math.round(value)));
}

export function isAppThemeId(value: string | null | undefined): value is AppThemeId {
  return APP_THEMES.some((theme) => theme.id === value);
}

export function buildThemeBootstrapScript() {
  return `(() => {
    try {
      const key = ${JSON.stringify(APP_THEME_STORAGE_KEY)};
      const imageKey = ${JSON.stringify(APP_THEME_BG_IMAGE_STORAGE_KEY)};
      const blurKey = ${JSON.stringify(APP_THEME_BG_BLUR_STORAGE_KEY)};
      const positionXKey = ${JSON.stringify(APP_THEME_BG_POSITION_X_STORAGE_KEY)};
      const positionYKey = ${JSON.stringify(APP_THEME_BG_POSITION_Y_STORAGE_KEY)};
      const scaleKey = ${JSON.stringify(APP_THEME_BG_SCALE_STORAGE_KEY)};
      const fallback = ${JSON.stringify(DEFAULT_APP_THEME)};
      const raw = window.localStorage.getItem(key);
      const image = window.localStorage.getItem(imageKey) || "";
      const blurRaw = window.localStorage.getItem(blurKey);
      const positionXRaw = window.localStorage.getItem(positionXKey);
      const positionYRaw = window.localStorage.getItem(positionYKey);
      const scaleRaw = window.localStorage.getItem(scaleKey);
      const allowed = new Set(${JSON.stringify(APP_THEMES.map((theme) => theme.id))});
      const theme = raw && allowed.has(raw) ? raw : fallback;
      const blur = Number.parseInt(blurRaw || "12", 10);
      const positionX = Number.parseInt(positionXRaw || "50", 10);
      const positionY = Number.parseInt(positionYRaw || "50", 10);
      const scale = Number.parseInt(scaleRaw || "108", 10);
      const safeBlur = Number.isFinite(blur) ? Math.max(0, Math.min(24, blur)) : 12;
      const safePositionX = Number.isFinite(positionX) ? Math.max(0, Math.min(100, positionX)) : 50;
      const safePositionY = Number.isFinite(positionY) ? Math.max(0, Math.min(100, positionY)) : 50;
      const safeScale = Number.isFinite(scale) ? Math.max(100, Math.min(180, scale)) : 108;
      const safeImage = image.replace(/"/g, "%22");
      const root = document.documentElement;
      root.dataset.theme = theme;
      root.style.setProperty("--app-bg-image", safeImage ? 'url("' + safeImage + '")' : "none");
      root.style.setProperty("--app-bg-blur", safeBlur + "px");
      root.style.setProperty("--app-bg-position-x", String(safePositionX));
      root.style.setProperty("--app-bg-position-y", String(safePositionY));
      root.style.setProperty("--app-bg-scale", String(safeScale));
      root.style.setProperty("--app-bg-image-opacity", theme === "photo" && image ? "0.46" : "0");
    } catch {
      const root = document.documentElement;
      root.dataset.theme = ${JSON.stringify(DEFAULT_APP_THEME)};
      root.style.setProperty("--app-bg-image", "none");
      root.style.setProperty("--app-bg-blur", "12px");
      root.style.setProperty("--app-bg-position-x", "50");
      root.style.setProperty("--app-bg-position-y", "50");
      root.style.setProperty("--app-bg-scale", "108");
      root.style.setProperty("--app-bg-image-opacity", "0");
    }
  })();`;
}
