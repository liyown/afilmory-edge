import process from 'node:process'

import { defineConfig } from 'drizzle-kit'

const isD1 = process.env.D1_REMOTE === '1'

export default defineConfig({
  schema: './src/schema.sqlite.ts',
  out: './migrations-sqlite',
  dialect: 'sqlite',
  ...(isD1
    ? {
        driver: 'd1-http',
        dbCredentials: {
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
          databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
          token: process.env.CLOUDFLARE_D1_TOKEN!,
        },
      }
    : {}),
})
