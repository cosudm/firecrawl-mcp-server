// @ts-check
/**
 * Layer 1 RBAC — App Role → compliance group → what a caller may invoke (§05).
 *
 * Entra App Roles decide whether a caller may invoke a tool at all; the Matrix
 * (Layer 2) decides what the governed answer is. This module owns the App-Role
 * half: the canonical role catalog and the tool→required-role policy. No role
 * for a tool → rejected before any code runs (least privilege; §05).
 */
import { AuthError } from './jwt.mjs';

/** Canonical App Roles and their Entra groups (the §05 mapping table). */
export const APP_ROLES = {
  'Compliance.Read':  { group: 'grp-ioslens-readers',  may: 'Read-only governance lookups. No writes.' },
  'Compliance.Decide': { group: 'grp-ioslens-decision', may: 'Run a compliance check, request a governed reasoning context.' },
  'Matrix.Propose':   { group: 'grp-ioslens-stewards', may: 'Submit proposed Matrix changes. Cannot publish.' },
  'Matrix.Admin':     { group: 'grp-ioslens-admin',    may: 'Approve and publish Matrix versions. The approval authority in §04.' },
  'Audit.Read':       { group: 'grp-ioslens-audit',    may: 'Read the audit store, for accreditors / reviewers.' },
};

/**
 * Tool → roles that may invoke it. A caller passes if they hold ANY listed role.
 * Least privilege: each tool names the narrowest sufficient role(s). No single
 * role both proposes and publishes a Matrix change.
 */
export const TOOL_POLICY = {
  'compliance.read':   ['Compliance.Read', 'Compliance.Decide', 'Matrix.Admin'],
  'compliance.decide': ['Compliance.Decide'],
  'matrix.propose':    ['Matrix.Propose', 'Matrix.Admin'],
  'matrix.publish':    ['Matrix.Admin'],
  'audit.read':        ['Audit.Read'],
};

/**
 * Extract the caller's roles from validated JWT claims. Entra emits App Roles in
 * the `roles` claim (array); some token shapes use space-delimited `scp`.
 * @param {Record<string, any>} claims
 * @returns {string[]}
 */
export function rolesFromClaims(claims) {
  if (Array.isArray(claims.roles)) return claims.roles;
  if (typeof claims.roles === 'string') return claims.roles.split(' ').filter(Boolean);
  if (typeof claims.scp === 'string') return claims.scp.split(' ').filter(Boolean);
  return [];
}

/**
 * Authorize a tool invocation against the caller's roles. Throws AuthError(403)
 * when no held role permits the tool — the "no role → rejected before any code
 * runs" guarantee.
 * @param {string} toolName
 * @param {string[]} roles
 */
export function authorizeTool(toolName, roles) {
  const allowed = TOOL_POLICY[toolName];
  if (!allowed) throw new AuthError(`unknown tool ${toolName}`, 404);
  const held = new Set(roles);
  if (!allowed.some((r) => held.has(r))) {
    throw new AuthError(`role required for ${toolName}: one of [${allowed.join(', ')}]`, 403);
  }
}
