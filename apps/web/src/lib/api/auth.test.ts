import assert from 'node:assert/strict'

import test from 'vitest'

import { canAccessDashboard } from './auth'

test('canAccessDashboard allows platform superadmins', () => {
  assert.equal(canAccessDashboard({ user: { role: 'superadmin' } }), true)
})

test('canAccessDashboard hides the dashboard from regular users and guests', () => {
  assert.equal(canAccessDashboard({ user: { role: 'user' } }), false)
  assert.equal(canAccessDashboard({ user: null }), false)
})
