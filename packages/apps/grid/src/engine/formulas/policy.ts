/** Data-only budgets shared by the worker and its independent main-thread watchdog. */
export const FORMULA_RESOURCE_LIMITS = {
  formulaCells: 20_000,
  formulaLength: 8_192,
  astNodes: 250_000,
  astDepth: 256,
  rangeCells: 100_000,
  referenceCells: 1_000_000,
  dependencyEdges: 250_000,
  analysisTimeMs: 5_000,
  maxWorkUnits: 1_000_000,
  maxEvalTimeMs: 1_500,
  workerTimeoutMs: 15_000,
} as const
