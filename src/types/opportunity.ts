/**
 * Arbitrage opportunity types and interfaces
 */

import type { ExchangeId } from '../config/schema.js';

import type {
  Amount,
  OpportunityId,
  Percentage,
  Price,
  TimestampMs,
  TradingSymbol,
  UsdValue,
} from './branded.js';

/**
 * Type of arbitrage opportunity
 */
export type ArbitrageType = 'simple' | 'triangular' | 'cross_triangular';

/**
 * Order side
 */
export type OrderSide = 'buy' | 'sell';

/**
 * Fee breakdown for an opportunity
 */
export interface FeeBreakdown {
  buyFee: Percentage;
  sellFee: Percentage;
  totalFee: Percentage;
}

/**
 * Slippage estimation
 */
export interface SlippageEstimate {
  estimated: Percentage; // Raw slippage estimate
  withMultiplier: Percentage; // With safety multiplier applied
}

/**
 * Volume information
 */
export interface VolumeInfo {
  availableBase: Amount; // Available liquidity in base currency
  tradeSizeBase: Amount; // Actual trade size in base
  tradeSizeUsd: UsdValue;
}

/**
 * Orderbook age info
 */
export interface OrderbookAges {
  buyMs: number;
  sellMs: number;
  maxMs: number;
}

/**
 * Simple arbitrage opportunity (buy on A, sell on B)
 */
export interface SimpleArbitrageOpportunity {
  id: OpportunityId;
  type: 'simple';
  symbol: TradingSymbol;

  // Exchanges
  buyExchange: ExchangeId;
  sellExchange: ExchangeId;

  // Prices
  buyPrice: Price; // Best ask on buy exchange
  sellPrice: Price; // Best bid on sell exchange

  // Profitability
  grossSpread: Percentage; // Before fees/slippage
  netProfit: Percentage; // After all costs
  estimatedProfitUsd: UsdValue;

  // Costs
  fees: FeeBreakdown;
  slippage: SlippageEstimate;

  // Volume
  volume: VolumeInfo;

  // Timing
  timestamp: TimestampMs;
  orderbookAges: OrderbookAges;
  isStale: boolean;

  // Confidence score (0-1)
  confidence: number;
}

/**
 * Single step in a triangular arbitrage path
 */
export interface TriangularStep {
  pair: TradingSymbol;
  side: OrderSide;
  price: Price;
  fee: Percentage;
  amountIn: Amount;
  amountOut: Amount;
}

/**
 * Triangular arbitrage opportunity (single exchange, 3 trades)
 */
export interface TriangularArbitrageOpportunity {
  id: OpportunityId;
  type: 'triangular';
  exchange: ExchangeId;

  // Path: 3 steps, e.g., USDT -> BTC -> ETH -> USDT
  path: [TriangularStep, TriangularStep, TriangularStep];
  pathDescription: string; // Human-readable: "USDT → BTC → ETH → USDT"

  // Amounts
  startAmount: Amount;
  endAmount: Amount;
  startCurrency: string;

  // Profitability
  netProfit: Percentage;
  estimatedProfitUsd: UsdValue;

  // Costs
  totalFees: Percentage;
  estimatedSlippage: Percentage;

  // Timing
  timestamp: TimestampMs;
  isStale: boolean;

  // Confidence score (0-1)
  confidence: number;
}

/**
 * Union type for all opportunity types
 */
export type ArbitrageOpportunity = SimpleArbitrageOpportunity | TriangularArbitrageOpportunity;

/**
 * Opportunity filter criteria
 */
export interface OpportunityFilter {
  minNetProfit?: Percentage;
  maxSlippage?: Percentage;
  exchanges?: ExchangeId[];
  symbols?: TradingSymbol[];
  types?: ArbitrageType[];
  maxOrderbookAgeMs?: number;
}

/**
 * Opportunity event for notifications
 */
export interface OpportunityEvent {
  opportunity: ArbitrageOpportunity;
  isNew: boolean; // First time seen
  priceChanged: boolean; // Price improved/degraded
  previousProfit?: Percentage; // If priceChanged
}
