const MULTISPACE_RE = /\s+/g;

function normalizeConfirmationText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(MULTISPACE_RE, " ").toUpperCase();
}

export function isStrongConfirmationValid(input: unknown, expectedText: string) {
  return normalizeConfirmationText(input) === normalizeConfirmationText(expectedText);
}

export function assertStrongConfirmation(input: unknown, expectedText: string, errorMessage: string) {
  if (!isStrongConfirmationValid(input, expectedText)) {
    throw new Error(errorMessage);
  }
}
