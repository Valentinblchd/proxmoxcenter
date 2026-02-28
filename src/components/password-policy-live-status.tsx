import { PASSWORD_POLICY_MESSAGES, evaluatePasswordPolicy } from "@/lib/auth/password-policy";

type Props = {
  password: string;
  confirmPassword?: string;
  requireConfirmation?: boolean;
  className?: string;
};

export default function PasswordPolicyLiveStatus({
  password,
  confirmPassword,
  requireConfirmation = false,
  className,
}: Props) {
  const policy = evaluatePasswordPolicy(password);
  const confirmationFilled = typeof confirmPassword === "string" && confirmPassword.length > 0;
  const confirmationMatches = requireConfirmation
    ? Boolean(confirmationFilled && confirmPassword === password)
    : true;

  const remainingRules: string[] = [];
  if (!policy.minLength) remainingRules.push(PASSWORD_POLICY_MESSAGES.minLength);
  if (!policy.uppercase) remainingRules.push(PASSWORD_POLICY_MESSAGES.uppercase);
  if (!policy.digit) remainingRules.push(PASSWORD_POLICY_MESSAGES.digit);
  if (!policy.special) remainingRules.push(PASSWORD_POLICY_MESSAGES.special);
  if (requireConfirmation && !confirmationMatches) {
    remainingRules.push("Les deux mots de passe doivent correspondre");
  }

  const allGood = policy.isValid && confirmationMatches;

  return (
    <div className={`password-live ${className ?? ""}`.trim()}>
      {remainingRules.length > 0 ? (
        <>
          <p className="password-live-title">Critères restants</p>
          <ul className="password-live-list" aria-live="polite">
            {remainingRules.map((rule) => (
              <li key={rule} className="password-live-item pending">
                <span className="password-live-dot" aria-hidden="true">
                  •
                </span>
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {allGood ? (
        <p className="password-live-ok" aria-live="polite">
          Mot de passe conforme
          {requireConfirmation ? " et confirmation OK." : "."}
        </p>
      ) : null}
    </div>
  );
}
