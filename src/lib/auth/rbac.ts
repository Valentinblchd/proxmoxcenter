export type RuntimeAuthUserRole = "reader" | "operator" | "admin";

export type RuntimeAuthCapability = "read" | "operate" | "admin";

const ROLE_RANK: Record<RuntimeAuthUserRole, number> = {
  reader: 10,
  operator: 20,
  admin: 30,
};

const CAPABILITY_MIN_RANK: Record<RuntimeAuthCapability, number> = {
  read: ROLE_RANK.reader,
  operate: ROLE_RANK.operator,
  admin: ROLE_RANK.admin,
};

export function normalizeRuntimeAuthUserRole(value: unknown): RuntimeAuthUserRole {
  if (value === "reader" || value === "operator" || value === "admin") {
    return value;
  }
  return "admin";
}

export function getDefaultSecondaryAuthRole(): RuntimeAuthUserRole {
  return "reader";
}

export function roleLabel(role: RuntimeAuthUserRole) {
  switch (role) {
    case "reader":
      return "Lecture";
    case "operator":
      return "Opérations";
    case "admin":
      return "Admin";
    default:
      return role;
  }
}

export function hasRuntimeCapability(
  role: RuntimeAuthUserRole | null | undefined,
  capability: RuntimeAuthCapability,
) {
  if (!role) return false;
  return ROLE_RANK[role] >= CAPABILITY_MIN_RANK[capability];
}

