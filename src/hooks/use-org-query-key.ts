import { useAuthStore } from '@/stores/auth-store';

/**
 * Returns the activeOrgId to include in React Query keys.
 * This ensures cache is properly scoped per organization.
 */
export function useOrgId() {
  return useAuthStore((s) => s.activeOrgId);
}
