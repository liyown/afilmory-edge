import { reactions } from '@afilmory/db'
import type { AnalysisResponse } from '@afilmory/sdk'
import { DbAccessor } from '@core/database/database.provider'
import { BizException, ErrorCode } from '@core/errors'
import { eq } from 'drizzle-orm'
import { injectable } from 'tsyringe'

@injectable()
export class ReactionService {
  constructor(private readonly dbAccessor: DbAccessor) {}

  async addReaction(refKey: string, reaction: string, count = 1): Promise<void> {
    const db = this.dbAccessor.get()

    // Check if photo exists (you might want to validate this differently based on your photo storage)
    // For now, we'll just add the reaction assuming the refKey is valid

    const row = {
      refKey,
      reaction,
    }

    try {
      await db.insert(reactions).values(Array.from<typeof row>({ length: count }).fill(row))
    }
    catch (error) {
      console.error('Failed to add reaction:', error)
      throw new BizException(ErrorCode.COMMON_BAD_REQUEST, {
        message: 'Failed to add reaction',
      })
    }
  }

  async getReactionAnalysis(refKey: string): Promise<AnalysisResponse> {
    const db = this.dbAccessor.get()

    const reactionRecords = await db
      .select({
        reaction: reactions.reaction,
      })
      .from(reactions)
      .where(eq(reactions.refKey, refKey))

    const aggregated = reactionRecords.reduce(
      (acc, record) => {
        acc[record.reaction] = (acc[record.reaction] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )

    return {
      data: {
        view: 0,
        reactions: aggregated,
      },
    }
  }
}
