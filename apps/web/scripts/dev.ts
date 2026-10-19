import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { $ } from 'execa'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workdir = path.resolve(__dirname, '..')

async function main() {
  // Get command line arguments excluding node and script name
  const args = process.argv.slice(2)
  await $({ cwd: workdir, stdio: 'inherit' })`vite --host ${args}`
}

main()
