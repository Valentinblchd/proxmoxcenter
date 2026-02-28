export type PasswordPolicyState = {
  minLength: boolean;
  uppercase: boolean;
  digit: boolean;
  special: boolean;
  isValid: boolean;
};

export const PASSWORD_POLICY_MESSAGES = {
  minLength: "12 caractères minimum",
  uppercase: "1 majuscule",
  digit: "1 chiffre",
  special: "1 caractère spécial",
} as const;

export function evaluatePasswordPolicy(password: string): PasswordPolicyState {
  const minLength = password.length >= 12;
  const uppercase = /[A-Z]/.test(password);
  const digit = /\d/.test(password);
  const special = /[^A-Za-z0-9]/.test(password);

  return {
    minLength,
    uppercase,
    digit,
    special,
    isValid: minLength && uppercase && digit && special,
  };
}

export function getPasswordPolicyError(password: string) {
  const state = evaluatePasswordPolicy(password);
  if (!state.minLength) {
    return "Le mot de passe doit contenir au moins 12 caractères.";
  }
  if (!state.uppercase) {
    return "Le mot de passe doit contenir au moins 1 majuscule.";
  }
  if (!state.digit) {
    return "Le mot de passe doit contenir au moins 1 chiffre.";
  }
  if (!state.special) {
    return "Le mot de passe doit contenir au moins 1 caractère spécial.";
  }
  return null;
}
