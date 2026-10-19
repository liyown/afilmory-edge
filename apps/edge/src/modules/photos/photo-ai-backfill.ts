import { DbAccessor, DrizzleProvider } from '@core/database/database.provider'

import { ManifestPublisher } from './manifest-publisher.service'
import { aiIndexEnabled, PhotoAiIndexer } from './photo-ai-indexer'

export async function runPhotoAiBackfill(limit = 10): Promise<number> {
  if (!aiIndexEnabled()) {
    return 0
  }
  const db = new DbAccessor(new DrizzleProvider())
  const indexer = new PhotoAiIndexer(db, new ManifestPublisher(db))
  return await indexer.backfill(limit)
}
