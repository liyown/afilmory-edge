export type BetterAuthUserRole = 'user' | 'admin' | 'superadmin'

export interface BetterAuthUser {
  id: string
  email: string
  name: string | null
  image: string | null
  role: BetterAuthUserRole
}

export interface BetterAuthSession {
  id: string
  expiresAt: string
  token: string
  userId: string
  createdAt: string
  updatedAt: string
}

export interface AuthState {
  user: BetterAuthUser
  session: BetterAuthSession
}
