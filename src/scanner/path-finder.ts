/**
 * Triangular Arbitrage Path Finder
 * Generates and validates triangular arbitrage paths from available trading pairs
 */

import { TRIANGULAR_PATHS } from '../config/exchanges.js';
import type { ExchangeId } from '../config/schema.js';
import type { TradingSymbol } from '../types/branded.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('path-finder');

/**
 * Order side for a trade step
 */
export type TradeSide = 'buy' | 'sell';

/**
 * Single step in a triangular path
 */
export interface PathStep {
  /** Trading pair symbol (e.g., "BTC/USDT") */
  pair: TradingSymbol;
  /** Base currency of the pair */
  base: string;
  /** Quote currency of the pair */
  quote: string;
  /** Whether to buy or sell the base currency */
  side: TradeSide;
  /** Currency we start this step with */
  inputCurrency: string;
  /** Currency we receive after this step */
  outputCurrency: string;
}

/**
 * Complete triangular arbitrage path (3 steps)
 */
export interface TriangularPath {
  /** Unique identifier for the path */
  id: string;
  /** Exchange this path is valid for */
  exchange: ExchangeId;
  /** Starting currency (e.g., "USDT") */
  startCurrency: string;
  /** Human-readable path description */
  description: string;
  /** The 3 trading steps */
  steps: [PathStep, PathStep, PathStep];
  /** Required trading pairs for this path */
  requiredPairs: [TradingSymbol, TradingSymbol, TradingSymbol];
}

/**
 * Path generation configuration
 */
export interface PathFinderConfig {
  /** Starting currencies to generate paths for */
  startCurrencies: string[];
  /** Base currencies to use as intermediates */
  intermediateCurrencies: string[];
  /** Use only preset paths from config */
  usePresetPathsOnly: boolean;
}

const DEFAULT_CONFIG: PathFinderConfig = {
  startCurrencies: ['USDT', 'USDC', 'BTC'],
  intermediateCurrencies: ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'],
  usePresetPathsOnly: true,
};

/**
 * Parse a trading symbol into base and quote currencies
 */
export function parseSymbol(symbol: string): { base: string; quote: string } | null {
  const parts = symbol.split('/');
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    return null;
  }
  return { base: parts[0], quote: parts[1] };
}

/**
 * Create a trading symbol from base and quote
 */
export function createSymbol(base: string, quote: string): TradingSymbol {
  return `${base}/${quote}` as TradingSymbol;
}

/**
 * Determine trade side and currencies for a step
 * Given a pair and the currency we have, determine if we buy or sell
 */
export function determineStepDetails(
  pair: TradingSymbol,
  inputCurrency: string
): { side: TradeSide; outputCurrency: string; base: string; quote: string } | null {
  const parsed = parseSymbol(pair);
  if (parsed === null) return null;

  const { base, quote } = parsed;

  // If we have the quote currency, we buy the base
  if (inputCurrency === quote) {
    return {
      side: 'buy',
      outputCurrency: base,
      base,
      quote,
    };
  }

  // If we have the base currency, we sell it for quote
  if (inputCurrency === base) {
    return {
      side: 'sell',
      outputCurrency: quote,
      base,
      quote,
    };
  }

  // Input currency doesn't match either side
  return null;
}

/**
 * Path Finder class
 * Generates and manages triangular arbitrage paths
 */
export class PathFinder {
  private readonly config: PathFinderConfig;
  private readonly paths: Map<ExchangeId, TriangularPath[]> = new Map();

  constructor(config: Partial<PathFinderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate paths from preset configurations
   * Uses TRIANGULAR_PATHS from exchange config
   */
  generatePresetPaths(exchange: ExchangeId): TriangularPath[] {
    const paths: TriangularPath[] = [];

    for (const pathConfig of TRIANGULAR_PATHS) {
      const path = this.buildPathFromPairs(
        exchange,
        pathConfig[0] as TradingSymbol,
        pathConfig[1] as TradingSymbol,
        pathConfig[2] as TradingSymbol
      );

      if (path !== null) {
        paths.push(path);
      }
    }

    return paths;
  }

  /**
   * Generate all possible triangular paths for an exchange
   * Based on available trading pairs
   */
  generateDynamicPaths(
    exchange: ExchangeId,
    availablePairs: TradingSymbol[]
  ): TriangularPath[] {
    const paths: TriangularPath[] = [];
    const seenPaths = new Set<string>();

    // Build adjacency map: currency -> [pairs that include it]
    const currencyToPairs = new Map<string, TradingSymbol[]>();

    for (const pair of availablePairs) {
      const parsed = parseSymbol(pair);
      if (parsed === null) continue;

      const { base, quote } = parsed;

      if (!currencyToPairs.has(base)) {
        currencyToPairs.set(base, []);
      }
      currencyToPairs.get(base)!.push(pair);

      if (!currencyToPairs.has(quote)) {
        currencyToPairs.set(quote, []);
      }
      currencyToPairs.get(quote)!.push(pair);
    }

    // For each start currency, find all valid triangular paths
    for (const startCurrency of this.config.startCurrencies) {
      const startPairs = currencyToPairs.get(startCurrency);
      if (startPairs === undefined) continue;

      // Step 1: Start -> Intermediate1
      for (const pair1 of startPairs) {
        const step1 = determineStepDetails(pair1, startCurrency);
        if (step1 === null) continue;

        const currency1 = step1.outputCurrency;
        if (currency1 === startCurrency) continue; // No self-loop

        // Step 2: Intermediate1 -> Intermediate2
        const pairs2 = currencyToPairs.get(currency1);
        if (pairs2 === undefined) continue;

        for (const pair2 of pairs2) {
          if (pair2 === pair1) continue; // Don't reuse same pair

          const step2 = determineStepDetails(pair2, currency1);
          if (step2 === null) continue;

          const currency2 = step2.outputCurrency;
          if (currency2 === startCurrency) continue; // Not yet back to start
          if (currency2 === currency1) continue; // No self-loop

          // Step 3: Intermediate2 -> Start (complete the cycle)
          const pairs3 = currencyToPairs.get(currency2);
          if (pairs3 === undefined) continue;

          for (const pair3 of pairs3) {
            if (pair3 === pair1 || pair3 === pair2) continue;

            const step3 = determineStepDetails(pair3, currency2);
            if (step3 === null) continue;

            // Must return to start currency
            if (step3.outputCurrency !== startCurrency) continue;

            // Create path ID for deduplication
            const pathId = [pair1, pair2, pair3].sort().join('|');
            if (seenPaths.has(pathId)) continue;
            seenPaths.add(pathId);

            const path = this.createPath(
              exchange,
              startCurrency,
              [
                { ...step1, pair: pair1, inputCurrency: startCurrency },
                { ...step2, pair: pair2, inputCurrency: currency1 },
                { ...step3, pair: pair3, inputCurrency: currency2 },
              ]
            );

            paths.push(path);
          }
        }
      }
    }

    logger.info(
      { exchange, pairCount: availablePairs.length, pathCount: paths.length },
      `Generated ${paths.length} triangular paths for ${exchange}`
    );

    return paths;
  }

  /**
   * Build a path from 3 trading pairs
   * Automatically determines the start currency and trade sides
   */
  buildPathFromPairs(
    exchange: ExchangeId,
    pair1: TradingSymbol,
    pair2: TradingSymbol,
    pair3: TradingSymbol
  ): TriangularPath | null {
    const parsed1 = parseSymbol(pair1);
    const parsed2 = parseSymbol(pair2);
    const parsed3 = parseSymbol(pair3);

    if (parsed1 === null || parsed2 === null || parsed3 === null) {
      return null;
    }

    // Find the start currency (appears in pair1 and pair3 but determines the cycle)
    // For preset paths, we assume they're ordered correctly
    // E.g., ['BTC/USDT', 'ETH/BTC', 'ETH/USDT'] means: USDT -> BTC -> ETH -> USDT

    // Find common currency between pair1 and pair3 that's not shared with pair2
    const currencies1 = [parsed1.base, parsed1.quote];
    const currencies3 = [parsed3.base, parsed3.quote];

    // The start currency is in pair1, pair3, and NOT the intermediate
    let startCurrency: string | null = null;

    for (const c of currencies1) {
      if (currencies3.includes(c)) {
        // Check if this forms a valid cycle
        const step1 = determineStepDetails(pair1, c);
        if (step1 === null) continue;

        const step2 = determineStepDetails(pair2, step1.outputCurrency);
        if (step2 === null) continue;

        const step3 = determineStepDetails(pair3, step2.outputCurrency);
        if (step3 === null) continue;

        if (step3.outputCurrency === c) {
          startCurrency = c;
          break;
        }
      }
    }

    if (startCurrency === null) {
      logger.debug(
        { pair1, pair2, pair3 },
        'Could not find valid start currency for path'
      );
      return null;
    }

    // Build the steps
    const step1 = determineStepDetails(pair1, startCurrency);
    if (step1 === null) return null;

    const step2 = determineStepDetails(pair2, step1.outputCurrency);
    if (step2 === null) return null;

    const step3 = determineStepDetails(pair3, step2.outputCurrency);
    if (step3 === null) return null;

    // Verify cycle completes
    if (step3.outputCurrency !== startCurrency) {
      logger.debug(
        { pair1, pair2, pair3, startCurrency, endCurrency: step3.outputCurrency },
        'Path does not form a complete cycle'
      );
      return null;
    }

    return this.createPath(exchange, startCurrency, [
      { ...step1, pair: pair1, inputCurrency: startCurrency },
      { ...step2, pair: pair2, inputCurrency: step1.outputCurrency },
      { ...step3, pair: pair3, inputCurrency: step2.outputCurrency },
    ]);
  }

  /**
   * Create a TriangularPath from steps
   */
  private createPath(
    exchange: ExchangeId,
    startCurrency: string,
    steps: [
      Omit<PathStep, 'base' | 'quote'> & { base: string; quote: string },
      Omit<PathStep, 'base' | 'quote'> & { base: string; quote: string },
      Omit<PathStep, 'base' | 'quote'> & { base: string; quote: string }
    ]
  ): TriangularPath {
    const currencies = [
      startCurrency,
      steps[0].outputCurrency,
      steps[1].outputCurrency,
      startCurrency,
    ];

    return {
      id: `${exchange}_${steps[0].pair}_${steps[1].pair}_${steps[2].pair}`,
      exchange,
      startCurrency,
      description: currencies.join(' → '),
      steps: steps as [PathStep, PathStep, PathStep],
      requiredPairs: [steps[0].pair, steps[1].pair, steps[2].pair],
    };
  }

  /**
   * Get or generate paths for an exchange
   */
  getPathsForExchange(
    exchange: ExchangeId,
    availablePairs?: TradingSymbol[]
  ): TriangularPath[] {
    // Check cache
    const cached = this.paths.get(exchange);
    if (cached !== undefined) {
      return cached;
    }

    let paths: TriangularPath[];

    if (this.config.usePresetPathsOnly || availablePairs === undefined) {
      paths = this.generatePresetPaths(exchange);
    } else {
      paths = this.generateDynamicPaths(exchange, availablePairs);
    }

    this.paths.set(exchange, paths);
    return paths;
  }

  /**
   * Filter paths to only those with available orderbooks
   */
  filterAvailablePaths(
    paths: TriangularPath[],
    availablePairs: Set<TradingSymbol>
  ): TriangularPath[] {
    return paths.filter((path) =>
      path.requiredPairs.every((pair) => availablePairs.has(pair))
    );
  }

  /**
   * Clear cached paths for an exchange
   */
  clearCache(exchange?: ExchangeId): void {
    if (exchange !== undefined) {
      this.paths.delete(exchange);
    } else {
      this.paths.clear();
    }
  }

  /**
   * Get all cached paths
   */
  getAllPaths(): Map<ExchangeId, TriangularPath[]> {
    return this.paths;
  }

  /**
   * Get path by ID
   */
  getPathById(pathId: string): TriangularPath | null {
    for (const paths of this.paths.values()) {
      const found = paths.find((p) => p.id === pathId);
      if (found !== undefined) {
        return found;
      }
    }
    return null;
  }
}

// Singleton instance
let pathFinderInstance: PathFinder | null = null;

/**
 * Get the global path finder
 */
export function getPathFinder(config?: Partial<PathFinderConfig>): PathFinder {
  pathFinderInstance ??= new PathFinder(config);
  return pathFinderInstance;
}

/**
 * Reset the global path finder (mainly for testing)
 */
export function resetPathFinder(): void {
  pathFinderInstance = null;
}
