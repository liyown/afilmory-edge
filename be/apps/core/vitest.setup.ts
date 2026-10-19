import 'reflect-metadata'

import process from 'node:process'

process.env.API_KEY = process.env.API_KEY ?? 'secret-key'
