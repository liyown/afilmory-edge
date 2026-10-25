import type { AdminOptions } from 'better-auth/plugins/admin'
import { adminAc, userAc } from 'better-auth/plugins/admin/access'

export const AUTH_ADMIN_PLUGIN_OPTIONS = {
  adminRoles: ['superadmin'],
  defaultRole: 'user',
  defaultBanReason: 'Spamming',
  roles: {
    superadmin: adminAc,
    // Application-level manager role. Keep it out of `adminRoles`: Better Auth
    // exposes admin endpoints (including role changes) to every admin role, so
    // granting that would let managers escalate themselves.
    admin: userAc,
    user: userAc,
  },
} satisfies AdminOptions
