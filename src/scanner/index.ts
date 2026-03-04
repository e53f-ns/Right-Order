/**
 * Scanner module
 * Arbitrage detection and profit calculation
 */

export {
  OrderbookAggregator,
  getOrderbookAggregator,
  resetOrderbookAggregator,
  type OrderbookAggregatorConfig,
} from './orderbook-aggregator.js';

export {
  ProfitCalculator,
  getProfitCalculator,
  resetProfitCalculator,
  type ProfitCalculatorConfig,
  type ProfitCalculationResult,
} from './profit-calculator.js';

export {
  SimpleArbDetector,
  getSimpleArbDetector,
  resetSimpleArbDetector,
  enableDashboard,
  type SimpleArbDetectorConfig,
} from './simple-arb-detector.js';

export {
  PathFinder,
  getPathFinder,
  resetPathFinder,
  parseSymbol,
  createSymbol,
  determineStepDetails,
  type PathFinderConfig,
  type PathStep,
  type TriangularPath,
  type TradeSide,
} from './path-finder.js';

export {
  TriangularDetector,
  getTriangularDetector,
  resetTriangularDetector,
  enableTriangularDashboard,
  type TriangularDetectorConfig,
} from './triangular-detector.js';
