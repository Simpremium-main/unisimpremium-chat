import type { AccessProfile, OrgRole } from '@prisma/client';
import { ACTION_KEYS, EffectiveAccess, PAGE_KEYS } from './catalog';

/** OWNER/ADMIN e atendente sem perfil: sem restrição (null). */
export function effectiveAccess(
  role: OrgRole,
  profile: Pick<AccessProfile, 'id' | 'name' | 'pages' | 'actions'> | null | undefined,
): EffectiveAccess | null {
  if (role !== 'AGENT' || !profile) return null;
  return {
    profileId: profile.id,
    profileName: profile.name,
    pages: profile.pages.filter((p) => PAGE_KEYS.has(p)),
    actions: profile.actions.filter((a) => ACTION_KEYS.has(a)),
  };
}
