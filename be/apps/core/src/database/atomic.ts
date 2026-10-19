/**
 * A list of statements that must run atomically. D1 has no interactive
 * transactions, so callers may only depend on statement results in `resolve`,
 * never while building later statements.
 */
export interface AtomicPlan<TResult> {
  statements: readonly unknown[]
  resolve: (results: readonly unknown[]) => TResult
}

export type AtomicBuilder<TDb, TResult> = (tx: TDb) => AtomicPlan<TResult> | Promise<AtomicPlan<TResult>>
