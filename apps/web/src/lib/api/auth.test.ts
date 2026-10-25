import assert from 'node:assert/strict'

import { it } from 'vitest'

import { canAccessDashboard } from './auth'

it('canAccessDashboard allows platform superadmins and admins', () => {
  assert.equal(canAccessDashboard({ user: { role: 'superadmin' } }), true)
  assert.equal(canAccessDashboard({ user: { role: 'admin' } }), true)
})

it('canAccessDashboard hides the dashboard from regular users and guests', () => {
  assert.equal(canAccessDashboard({ user: { role: 'user' } }), false)
  assert.equal(canAccessDashboard({ user: null }), false)
})
