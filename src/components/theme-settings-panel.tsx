"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  APP_THEMES,
  APP_THEME_BG_BLUR_STORAGE_KEY,
  APP_THEME_BG_IMAGE_STORAGE_KEY,
  APP_THEME_BG_POSITION_X_STORAGE_KEY,
  APP_THEME_BG_POSITION_Y_STORAGE_KEY,
  APP_THEME_BG_SCALE_STORAGE_KEY,
  APP_THEME_STORAGE_KEY,
  type AppThemeId,
  DEFAULT_APP_THEME,
  isAppThemeId,
  normalizeThemeBackgroundBlur,
  normalizeThemeBackgroundPosition,
  normalizeThemeBackgroundScale,
} from "@/lib/ui/themes";

const ALLOWED_BACKGROUND_FILE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif", ".dng"] as const;
const ALLOWED_BACKGROUND_FILE_ACCEPT = ALLOWED_BACKGROUND_FILE_EXTENSIONS.join(",");

function getFileExtension(value: string) {
  const normalized = value.trim().toLowerCase();
  const lastDotIndex = normalized.lastIndexOf(".");
  return lastDotIndex >= 0 ? normalized.slice(lastDotIndex) : "";
}

function isAllowedBackgroundFileName(value: string) {
  return ALLOWED_BACKGROUND_FILE_EXTENSIONS.includes(
    getFileExtension(value) as (typeof ALLOWED_BACKGROUND_FILE_EXTENSIONS)[number],
  );
}

function isAllowedBackgroundImageUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    return isAllowedBackgroundFileName(decodeURIComponent(parsed.pathname));
  } catch {
    return false;
  }
}

function readStoredTheme() {
  if (typeof window === "undefined") return DEFAULT_APP_THEME;
  try {
    const stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    return isAppThemeId(stored) ? stored : DEFAULT_APP_THEME;
  } catch {
    return DEFAULT_APP_THEME;
  }
}

function readStoredImage() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(APP_THEME_BG_IMAGE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function readStoredBlur() {
  if (typeof window === "undefined") return 12;
  try {
    return normalizeThemeBackgroundBlur(
      Number.parseInt(window.localStorage.getItem(APP_THEME_BG_BLUR_STORAGE_KEY) || "12", 10),
    );
  } catch {
    return 12;
  }
}

function readStoredPositionX() {
  if (typeof window === "undefined") return 50;
  try {
    return normalizeThemeBackgroundPosition(
      Number.parseInt(window.localStorage.getItem(APP_THEME_BG_POSITION_X_STORAGE_KEY) || "50", 10),
    );
  } catch {
    return 50;
  }
}

function readStoredPositionY() {
  if (typeof window === "undefined") return 50;
  try {
    return normalizeThemeBackgroundPosition(
      Number.parseInt(window.localStorage.getItem(APP_THEME_BG_POSITION_Y_STORAGE_KEY) || "50", 10),
    );
  } catch {
    return 50;
  }
}

function readStoredScale() {
  if (typeof window === "undefined") return 108;
  try {
    return normalizeThemeBackgroundScale(
      Number.parseInt(window.localStorage.getItem(APP_THEME_BG_SCALE_STORAGE_KEY) || "108", 10),
    );
  } catch {
    return 108;
  }
}

function applyThemeSettings(
  theme: AppThemeId,
  image: string,
  blur: number,
  positionX: number,
  positionY: number,
  scale: number,
  persist = true,
) {
  const safeBlur = normalizeThemeBackgroundBlur(blur);
  const safePositionX = normalizeThemeBackgroundPosition(positionX);
  const safePositionY = normalizeThemeBackgroundPosition(positionY);
  const safeScale = normalizeThemeBackgroundScale(scale);
  const root = document.documentElement;

  root.dataset.theme = theme;
  root.style.setProperty("--app-bg-image", image ? `url("${image.replace(/"/g, "%22")}")` : "none");
  root.style.setProperty("--app-bg-blur", `${safeBlur}px`);
  root.style.setProperty("--app-bg-position-x", String(safePositionX));
  root.style.setProperty("--app-bg-position-y", String(safePositionY));
  root.style.setProperty("--app-bg-scale", String(safeScale));
  root.style.setProperty("--app-bg-image-opacity", theme === "photo" && image ? "0.46" : "0");

  if (persist) {
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
    window.localStorage.setItem(APP_THEME_BG_BLUR_STORAGE_KEY, String(safeBlur));
    window.localStorage.setItem(APP_THEME_BG_POSITION_X_STORAGE_KEY, String(safePositionX));
    window.localStorage.setItem(APP_THEME_BG_POSITION_Y_STORAGE_KEY, String(safePositionY));
    window.localStorage.setItem(APP_THEME_BG_SCALE_STORAGE_KEY, String(safeScale));
    if (image) {
      window.localStorage.setItem(APP_THEME_BG_IMAGE_STORAGE_KEY, image);
    } else {
      window.localStorage.removeItem(APP_THEME_BG_IMAGE_STORAGE_KEY);
    }
    window.dispatchEvent(new CustomEvent("proxmoxcenter:theme-change"));
  }
}

async function fileToStoredImage(file: File) {
  if (!isAllowedBackgroundFileName(file.name)) {
    throw new Error("Format refusé. Utilise PNG, JPG, JPEG, WebP, AVIF ou DNG.");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new window.Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Image invalide."));
      nextImage.src = objectUrl;
    });

    const maxSide = 1920;
    const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * ratio));
    const height = Math.max(1, Math.round(image.height * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas indisponible.");
    }
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch (error) {
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith(".dng")) {
      throw new Error("DNG accepté, mais non lisible par ce navigateur ici. Utilise PNG, JPG, WebP ou AVIF si besoin.");
    }
    throw error;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function ThemeSettingsPanel() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [theme, setTheme] = useState<AppThemeId>(readStoredTheme);
  const [backgroundImage, setBackgroundImage] = useState<string>(readStoredImage);
  const [blur, setBlur] = useState<number>(readStoredBlur);
  const [positionX, setPositionX] = useState<number>(readStoredPositionX);
  const [positionY, setPositionY] = useState<number>(readStoredPositionY);
  const [scale, setScale] = useState<number>(readStoredScale);

  const [photoEditorOpen, setPhotoEditorOpen] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [draftImage, setDraftImage] = useState<string>(readStoredImage);
  const [draftBlur, setDraftBlur] = useState<number>(readStoredBlur);
  const [draftPositionX, setDraftPositionX] = useState<number>(readStoredPositionX);
  const [draftPositionY, setDraftPositionY] = useState<number>(readStoredPositionY);
  const [draftScale, setDraftScale] = useState<number>(readStoredScale);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [status, setStatus] = useState("");

  const currentPhotoStyle = useMemo(
    () => ({
      backgroundImage: backgroundImage ? `url("${backgroundImage}")` : undefined,
      filter: `blur(${blur}px)`,
      backgroundPosition: `${positionX}% ${positionY}%`,
      transform: `scale(${scale / 100})`,
    }),
    [backgroundImage, blur, positionX, positionY, scale],
  );

  const draftPreviewStyle = useMemo(
    () => ({
      objectPosition: `${draftPositionX}% ${draftPositionY}%`,
      transform: `scale(${draftScale / 100})`,
      filter: `blur(${draftBlur}px)`,
    }),
    [draftBlur, draftPositionX, draftPositionY, draftScale],
  );

  useEffect(() => {
    if (!photoEditorOpen || !isPreviewing) return;
    applyThemeSettings("photo", draftImage, draftBlur, draftPositionX, draftPositionY, draftScale, false);
  }, [photoEditorOpen, isPreviewing, draftImage, draftBlur, draftPositionX, draftPositionY, draftScale]);

  function revertToSavedTheme() {
    applyThemeSettings(theme, backgroundImage, blur, positionX, positionY, scale, false);
    setIsPreviewing(false);
  }

  function closePhotoEditor() {
    revertToSavedTheme();
    setPhotoEditorOpen(false);
    setStatus("");
  }

  function applySimpleTheme(nextTheme: AppThemeId) {
    setTheme(nextTheme);
    applyThemeSettings(nextTheme, backgroundImage, blur, positionX, positionY, scale, true);
    setPhotoEditorOpen(false);
    setIsPreviewing(false);
    setStatus("");
  }

  function openPhotoEditor() {
    setDraftImage(backgroundImage);
    setDraftBlur(blur);
    setDraftPositionX(positionX);
    setDraftPositionY(positionY);
    setDraftScale(scale);
    setImageUrlInput(
      backgroundImage.startsWith("http://") || backgroundImage.startsWith("https://") ? backgroundImage : "",
    );
    setStatus("");
    setIsPreviewing(false);
    setPhotoEditorOpen(true);
  }

  function previewPhotoTheme() {
    applyThemeSettings("photo", draftImage, draftBlur, draftPositionX, draftPositionY, draftScale, false);
    setIsPreviewing(true);
    setStatus(draftImage ? "Prévisualisation active" : "Aucune image à prévisualiser");
  }

  function applyPhotoTheme() {
    const nextBlur = normalizeThemeBackgroundBlur(draftBlur);
    const nextPositionX = normalizeThemeBackgroundPosition(draftPositionX);
    const nextPositionY = normalizeThemeBackgroundPosition(draftPositionY);
    const nextScale = normalizeThemeBackgroundScale(draftScale);
    setTheme("photo");
    setBackgroundImage(draftImage);
    setBlur(nextBlur);
    setPositionX(nextPositionX);
    setPositionY(nextPositionY);
    setScale(nextScale);
    applyThemeSettings("photo", draftImage, nextBlur, nextPositionX, nextPositionY, nextScale, true);
    setPhotoEditorOpen(false);
    setIsPreviewing(false);
    setStatus(draftImage ? "Image appliquée" : "");
  }

  const hasDraftImage = draftImage.trim().length > 0;
  const canUseUrl = isAllowedBackgroundImageUrl(imageUrlInput) && !isLoadingImage;

  return (
    <div className="stack-sm">
      <div className="theme-grid">
        {APP_THEMES.map((option) => {
          const active = theme === option.id;
          if (option.id === "photo") {
            return (
              <button
                key={option.id}
                type="button"
                className={`theme-card theme-card-photo${active ? " is-active" : ""}${photoEditorOpen ? " is-open" : ""}`}
                onClick={() => {
                  if (photoEditorOpen) {
                    closePhotoEditor();
                  } else {
                    openPhotoEditor();
                  }
                }}
                aria-pressed={active}
                aria-expanded={photoEditorOpen}
              >
                <span className="theme-card-preview" aria-hidden="true">
                  {backgroundImage ? <span className="theme-card-photo-overlay" style={currentPhotoStyle} /> : null}
                  <span className="theme-card-rail" />
                  <span className="theme-card-panel" />
                  <span className="theme-card-chip" />
                </span>
                <span className="theme-card-copy">
                  <strong>{option.label}</strong>
                  <span>{option.hint}</span>
                </span>
              </button>
            );
          }

          return (
            <button
              key={option.id}
              type="button"
              className={`theme-card theme-card-${option.id}${active ? " is-active" : ""}`}
              onClick={() => applySimpleTheme(option.id)}
              aria-pressed={active}
            >
              <span className="theme-card-preview" aria-hidden="true">
                <span className="theme-card-rail" />
                <span className="theme-card-panel" />
                <span className="theme-card-chip" />
              </span>
              <span className="theme-card-copy">
                <strong>{option.label}</strong>
                <span>{option.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {photoEditorOpen ? (
        <section className="theme-photo-editor-panel">
          <div className="theme-photo-editor-head">
            <div className="theme-card-copy">
              <strong>Image de fond</strong>
              <span>URL ou fichier local. Les réglages apparaissent après chargement.</span>
            </div>
            <button type="button" className="action-btn" onClick={closePhotoEditor}>
              Fermer
            </button>
          </div>

          <div className="theme-inline-editor">
            <div className="theme-image-source-grid">
              <div className="stack-sm">
                <label className="theme-image-label" htmlFor="theme-image-url">
                  URL image
                </label>
                <div className="theme-image-input-row">
                  <input
                    id="theme-image-url"
                    type="url"
                    className="inventory-remote-input"
                    placeholder="https://exemple.com/fond.jpg"
                    value={imageUrlInput}
                    onChange={(event) => setImageUrlInput(event.currentTarget.value)}
                  />
                  <button
                    type="button"
                    className="action-btn"
                    disabled={!canUseUrl}
                    onClick={() => {
                      const nextImage = imageUrlInput.trim();
                      if (!isAllowedBackgroundImageUrl(nextImage)) {
                        setStatus("URL refusée. Lien direct sans query requis vers PNG, JPG, JPEG, WebP, AVIF ou DNG.");
                        return;
                      }
                      setDraftImage(nextImage);
                      setStatus("URL prête");
                    }}
                  >
                    Utiliser
                  </button>
                </div>
              </div>

              <div className="theme-upload-card">
                <span className="theme-upload-title">Depuis ton PC</span>
                <span className="muted">PNG, JPG, JPEG, WebP, AVIF, DNG</span>
                <div className="theme-upload-actions">
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isLoadingImage}
                  >
                    {isLoadingImage ? "Chargement..." : "Choisir une image"}
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_BACKGROUND_FILE_ACCEPT}
                  hidden
                  tabIndex={-1}
                  onChange={async (event) => {
                    const file = event.currentTarget.files?.[0];
                    if (!file) return;
                    try {
                      setIsLoadingImage(true);
                      const nextImage = await fileToStoredImage(file);
                      setDraftImage(nextImage);
                      setImageUrlInput("");
                      setStatus("Image chargée");
                    } catch (error) {
                      setStatus(error instanceof Error ? error.message : "Image refusée");
                    } finally {
                      setIsLoadingImage(false);
                      event.currentTarget.value = "";
                    }
                  }}
                />
              </div>
            </div>

            {hasDraftImage ? (
              <div className="theme-upload-preview">
                <div className="theme-photo-preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={draftImage} alt="Aperçu du fond" style={draftPreviewStyle} />
                </div>
              </div>
            ) : null}

            {hasDraftImage ? (
              <>
                <div className="theme-blur-row">
                  <label className="theme-blur-label" htmlFor="theme-photo-blur">
                    Flou
                  </label>
                  <input
                    id="theme-photo-blur"
                    type="range"
                    min={0}
                    max={24}
                    step={1}
                    value={draftBlur}
                    onChange={(event) =>
                      setDraftBlur(normalizeThemeBackgroundBlur(Number.parseInt(event.currentTarget.value, 10)))
                    }
                  />
                  <strong>{draftBlur}px</strong>
                </div>

                <div className="theme-blur-row">
                  <label className="theme-blur-label" htmlFor="theme-photo-scale">
                    Zoom
                  </label>
                  <input
                    id="theme-photo-scale"
                    type="range"
                    min={100}
                    max={180}
                    step={1}
                    value={draftScale}
                    onChange={(event) =>
                      setDraftScale(normalizeThemeBackgroundScale(Number.parseInt(event.currentTarget.value, 10)))
                    }
                  />
                  <strong>{draftScale}%</strong>
                </div>

                <div className="theme-position-grid">
                  <div className="theme-blur-row">
                    <label className="theme-blur-label" htmlFor="theme-photo-position-x">
                      Centre X
                    </label>
                    <input
                      id="theme-photo-position-x"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={draftPositionX}
                      onChange={(event) =>
                        setDraftPositionX(
                          normalizeThemeBackgroundPosition(Number.parseInt(event.currentTarget.value, 10)),
                        )
                      }
                    />
                    <strong>{draftPositionX}%</strong>
                  </div>

                  <div className="theme-blur-row">
                    <label className="theme-blur-label" htmlFor="theme-photo-position-y">
                      Centre Y
                    </label>
                    <input
                      id="theme-photo-position-y"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={draftPositionY}
                      onChange={(event) =>
                        setDraftPositionY(
                          normalizeThemeBackgroundPosition(Number.parseInt(event.currentTarget.value, 10)),
                        )
                      }
                    />
                    <strong>{draftPositionY}%</strong>
                  </div>
                </div>
              </>
            ) : null}

            <div className="theme-inline-actions">
              <button
                type="button"
                className="action-btn"
                disabled={!hasDraftImage || isLoadingImage}
                onClick={() => {
                  setDraftImage("");
                  setImageUrlInput("");
                  setDraftBlur(12);
                  setDraftPositionX(50);
                  setDraftPositionY(50);
                  setDraftScale(108);
                  setStatus("Image supprimée");
                }}
              >
                Supprimer
              </button>
              <div className="theme-image-dialog-actions-right">
                {hasDraftImage ? (
                  <button type="button" className="action-btn" onClick={previewPhotoTheme}>
                    {isPreviewing ? "Prévisualisation mise à jour" : "Prévisualiser"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="action-btn"
                  disabled={!hasDraftImage || isLoadingImage}
                  onClick={() => {
                    setDraftPositionX(50);
                    setDraftPositionY(50);
                    setDraftScale(108);
                    setStatus("Cadrage recentré");
                  }}
                >
                  Recentrer
                </button>
                <button
                  type="button"
                  className="action-btn primary"
                  disabled={!hasDraftImage || isLoadingImage}
                  onClick={applyPhotoTheme}
                >
                  Appliquer
                </button>
              </div>
            </div>

            {status ? <div className="muted">{status}</div> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
