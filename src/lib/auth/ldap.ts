import "server-only";
import { Client, type Entry } from "ldapts";
import { readRuntimeProxmoxConfig, readRuntimeLdapBindPassword } from "@/lib/proxmox/runtime-config";

type VerifyLdapCredentialsResult =
  | { ok: true; username: string }
  | { ok: false; reason: string };

function normalizeUsername(value: string) {
  return value.trim();
}

function escapeLdapFilterValue(value: string) {
  return value.replace(/[\0()*\\]/g, (char) => {
    if (char === "\0") return "\\00";
    if (char === "*") return "\\2a";
    if (char === "(") return "\\28";
    if (char === ")") return "\\29";
    return "\\5c";
  });
}

function buildUserFilter(template: string, username: string) {
  const escaped = escapeLdapFilterValue(username);
  if (template.includes("{username}")) {
    return template.replaceAll("{username}", escaped);
  }
  if (template.includes("{user}")) {
    return template.replaceAll("{user}", escaped);
  }
  return template;
}

function extractDn(entry: Entry): string | null {
  const raw = entry.dn;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function buildPrincipalCandidates(username: string, realm: string) {
  const candidates = [username];
  const cleanRealm = realm.trim();
  if (cleanRealm && !cleanRealm.includes("=") && !username.includes("@")) {
    candidates.push(`${username}@${cleanRealm}`);
    candidates.push(`${cleanRealm}\\${username}`);
  }
  return [...new Set(candidates)];
}

export function isLdapSecondaryAuthEnabled() {
  return Boolean(readRuntimeProxmoxConfig()?.ldap.enabled);
}

export async function verifyLdapCredentials(
  usernameRaw: string,
  password: string,
): Promise<VerifyLdapCredentialsResult> {
  const runtime = readRuntimeProxmoxConfig();
  if (!runtime?.ldap.enabled) {
    return { ok: false, reason: "LDAP disabled." };
  }

  const username = normalizeUsername(usernameRaw);
  if (!username || !password) {
    return { ok: false, reason: "Missing username/password." };
  }

  const ldap = runtime.ldap;
  if (!ldap.serverUrl || !ldap.baseDn || !ldap.userFilter) {
    return { ok: false, reason: "LDAP config incomplete." };
  }

  const tlsOptions = {
    rejectUnauthorized: !ldap.allowInsecureTls,
    ...(runtime.customCaCertPem ? { ca: runtime.customCaCertPem } : {}),
  };
  const client = new Client({
    url: ldap.serverUrl,
    timeout: 8_000,
    connectTimeout: 8_000,
    tlsOptions,
  });

  try {
    if (ldap.startTls) {
      await client.startTLS(tlsOptions);
    }

    let userDn: string | null = null;
    const bindDn = ldap.bindDn.trim();
    const bindPassword = readRuntimeLdapBindPassword(runtime) ?? "";

    if (bindDn) {
      await client.bind(bindDn, bindPassword);
      const filter = buildUserFilter(ldap.userFilter, username);
      const searchResult = await client.search(ldap.baseDn, {
        scope: "sub",
        filter,
        attributes: ["dn"],
        sizeLimit: 2,
      });
      const entries = searchResult.searchEntries
        .map((entry) => extractDn(entry))
        .filter((dn): dn is string => Boolean(dn));
      if (entries.length !== 1) {
        return { ok: false, reason: "LDAP user not found or ambiguous." };
      }
      userDn = entries[0];
    }

    if (userDn) {
      await client.bind(userDn, password);
      return { ok: true, username };
    }

    const candidates = buildPrincipalCandidates(username, ldap.realm);
    for (const principal of candidates) {
      try {
        await client.bind(principal, password);
        return { ok: true, username };
      } catch {
        // Try next candidate.
      }
    }

    return { ok: false, reason: "LDAP bind failed." };
  } catch {
    return { ok: false, reason: "LDAP auth failed." };
  } finally {
    try {
      await client.unbind();
    } catch {
      // no-op
    }
  }
}
