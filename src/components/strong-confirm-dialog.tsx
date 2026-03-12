"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type StrongConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  expectedText: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (confirmationText: string) => void;
};

export default function StrongConfirmDialog({
  open,
  title,
  message,
  expectedText,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: StrongConfirmDialogProps) {
  const [value, setValue] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      setValue("");
    }
  }, [open, expectedText]);

  if (!open || !mounted) return null;

  const normalizedValue = value.trim().replace(/\s+/g, " ").toUpperCase();
  const normalizedExpected = expectedText.trim().replace(/\s+/g, " ").toUpperCase();
  const canConfirm = normalizedValue === normalizedExpected && !busy;

  return createPortal(
    <div className="logout-confirm-layer" role="presentation">
      <button
        type="button"
        className="logout-confirm-backdrop"
        onClick={onCancel}
        aria-label="Fermer la confirmation"
      />
      <section
        className="logout-confirm-dialog strong-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="strong-confirm-title"
      >
        <h2 id="strong-confirm-title">{title}</h2>
        <p className="muted">{message}</p>
        <div className="field">
          <label className="field-label" htmlFor="strong-confirm-input">
            Tape exactement
          </label>
          <code className="strong-confirm-code">{expectedText}</code>
          <input
            id="strong-confirm-input"
            className="field-input"
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={expectedText}
            autoFocus
          />
        </div>
        <div className="logout-confirm-actions">
          <button type="button" className="action-btn" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button
            type="button"
            className="action-btn primary"
            disabled={!canConfirm}
            onClick={() => onConfirm(value)}
          >
            {busy ? "Confirmation..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
