import assert from 'node:assert/strict'

import { it } from 'vitest'

import { canAccessDashboard } from './api/auth'
import { camelCaseKeys } from './case'

it('camelCaseKeys converts nested snake_case keys', () => {
  assert.deepEqual(
    camelCaseKeys({
      user_id: 'u1',
      next_cursor: null,
    }),
    {
      userId: 'u1',
      nextCursor: null,
    },
  )
})

it('camelCaseKeys leaves camelCase payloads unchanged', () => {
  const payload = {
    userId: 'u1',
  }

  assert.deepEqual(camelCaseKeys(payload), payload)
})

it('camelCaseKeys restores dashboard access from the session API payload', () => {
  const session = camelCaseKeys<{
    user: { role: string }
  }>({
    user: { role: 'superadmin' },
  })

  assert.equal(canAccessDashboard(session), true)
})
