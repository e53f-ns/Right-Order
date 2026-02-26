/**
 * Dynamic symbol manager
 * Fetches and maintains active trading symbols from exchanges
 * Falls back to hardcoded list when fetchMarkets fails
 */

import type { Exchange } from 'ccxt';

import type { ExchangeId } from '../config/schema.js';
import { createTradingSymbol, type TradingSymbol } from '../types/branded.js';

import { createLogger } from './logger.js';
import { sleep } from './retry.js';

const logger = createLogger('symbol-manager');

/**
 * Fallback symbols - 300+ liquid trading pairs
 * Used when fetchMarkets fails or returns insufficient data (<30 pairs)
 */
const FALLBACK_SYMBOLS: readonly string[] = [
  // =============================================
  // TOP 40 by market cap (USDT)
  // =============================================
  'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT',
  'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT', 'TRX/USDT', 'TON/USDT',
  'LINK/USDT', 'DOT/USDT', 'MATIC/USDT', 'SHIB/USDT', 'LTC/USDT',
  'BCH/USDT', 'NEAR/USDT', 'UNI/USDT', 'APT/USDT', 'ICP/USDT',
  'ETC/USDT', 'XMR/USDT', 'ATOM/USDT', 'FIL/USDT', 'HBAR/USDT',
  'MNT/USDT', 'RENDER/USDT', 'TAO/USDT', 'IMX/USDT', 'STX/USDT',
  'CRO/USDT', 'OKB/USDT', 'LEO/USDT', 'VET/USDT', 'MKR/USDT',
  'OP/USDT', 'ARB/USDT', 'AAVE/USDT', 'GRT/USDT', 'INJ/USDT',

  // =============================================
  // DeFi tokens (35)
  // =============================================
  'COMP/USDT', 'SNX/USDT', 'CRV/USDT', 'LDO/USDT', 'SUSHI/USDT',
  'YFI/USDT', 'BAL/USDT', '1INCH/USDT', 'DYDX/USDT', 'GMX/USDT',
  'PENDLE/USDT', 'CAKE/USDT', 'JUP/USDT', 'UMA/USDT', 'SPELL/USDT',
  'CVX/USDT', 'FXS/USDT', 'OSMO/USDT', 'RUNE/USDT', 'LQTY/USDT',
  'RPL/USDT', 'FRAX/USDT', 'RAY/USDT', 'ONDO/USDT', 'ENA/USDT',
  'ETHFI/USDT', 'W/USDT', 'EIGEN/USDT', 'MORPHO/USDT', 'ZRO/USDT',
  'AERO/USDT', 'VELO/USDT', 'USUAL/USDT', 'COW/USDT', 'BANANA/USDT',

  // =============================================
  // Layer 1 blockchains (40)
  // =============================================
  'SUI/USDT', 'SEI/USDT', 'FTM/USDT', 'ALGO/USDT', 'EOS/USDT',
  'XLM/USDT', 'EGLD/USDT', 'THETA/USDT', 'XTZ/USDT', 'FLOW/USDT',
  'MINA/USDT', 'KAVA/USDT', 'AR/USDT', 'ROSE/USDT', 'ONE/USDT',
  'ZIL/USDT', 'QTUM/USDT', 'ICX/USDT', 'WAVES/USDT', 'NEO/USDT',
  'IOST/USDT', 'ONT/USDT', 'CELO/USDT', 'KDA/USDT', 'LUNA/USDT',
  'KLAY/USDT', 'XDC/USDT', 'TFUEL/USDT', 'KAS/USDT', 'CORE/USDT',
  'QNT/USDT', 'IOTA/USDT', 'ZEC/USDT', 'DASH/USDT', 'DCR/USDT',
  'SC/USDT', 'ZEN/USDT', 'RVN/USDT', 'XEC/USDT', 'BEAM/USDT',

  // =============================================
  // Layer 2 & Scaling (25)
  // =============================================
  'STRK/USDT', 'ZK/USDT', 'MANTA/USDT', 'METIS/USDT', 'LRC/USDT',
  'BOBA/USDT', 'CTSI/USDT', 'SKL/USDT', 'CELR/USDT', 'OMG/USDT',
  'DUSK/USDT', 'COTI/USDT', 'MOVR/USDT', 'GLMR/USDT', 'ASTR/USDT',
  'ZKJ/USDT', 'MODE/USDT', 'BLAST/USDT', 'SCROLL/USDT', 'LINEA/USDT',
  'ZKSYNC/USDT', 'BASE/USDT', 'TAIKO/USDT', 'FUEL/USDT', 'MONAD/USDT',

  // =============================================
  // Memecoins (50) - High volume arbitrage opportunity
  // =============================================
  'PEPE/USDT', 'WIF/USDT', 'FLOKI/USDT', 'BONK/USDT', 'MEME/USDT',
  'TURBO/USDT', 'BOME/USDT', 'NEIRO/USDT', '1000SATS/USDT', 'RATS/USDT',
  'COQ/USDT', 'PONKE/USDT', 'POPCAT/USDT', 'DOGS/USDT', 'BRETT/USDT',
  'MOG/USDT', 'MEW/USDT', 'MYRO/USDT', 'SLERF/USDT', 'PNUT/USDT',
  'ACT/USDT', 'SPX/USDT', 'GOAT/USDT', 'TRUMP/USDT', 'MICHI/USDT',
  'CHILLGUY/USDT', 'FARTCOIN/USDT', 'PENGU/USDT', 'DEGEN/USDT', 'HIGHER/USDT',
  'TOSHI/USDT', 'NORMIE/USDT', 'WEN/USDT', 'BODEN/USDT', 'TREMP/USDT',
  'MAGA/USDT', 'GIGA/USDT', 'RETARDIO/USDT', 'BARSIK/USDT', 'CAT/USDT',
  'HAMSTER/USDT', 'NOT/USDT', 'BANANA/USDT', 'MOTHER/USDT', 'DADDY/USDT',
  'PUPS/USDT', 'RUNESTONE/USDT', 'NODOGE/USDT', 'SNEK/USDT', 'HARAMBE/USDT',

  // =============================================
  // AI & Data (35) - Hot sector
  // =============================================
  'FET/USDT', 'RNDR/USDT', 'AGIX/USDT', 'OCEAN/USDT', 'WLD/USDT',
  'ARKM/USDT', 'VIDT/USDT', 'NMR/USDT', 'GNO/USDT', 'AI/USDT',
  'IO/USDT', 'PHB/USDT', 'CTXC/USDT', 'DKA/USDT', 'ORAI/USDT',
  'RSS3/USDT', 'AIOZ/USDT', 'GPU/USDT', 'VIRTUAL/USDT', 'AI16Z/USDT',
  'GRIFFAIN/USDT', 'ZEREBRO/USDT', 'ARC/USDT', 'FLOCK/USDT', 'GRASS/USDT',
  'TAO/USDT', 'BITTENSOR/USDT', 'PRIME/USDT', 'NOS/USDT', 'MASA/USDT',
  'OLAS/USDT', 'PAAL/USDT', 'AGRS/USDT', 'CGPT/USDT', 'ALI/USDT',

  // =============================================
  // Gaming & Metaverse (30)
  // =============================================
  'AXS/USDT', 'SAND/USDT', 'MANA/USDT', 'GALA/USDT', 'ENJ/USDT',
  'ILV/USDT', 'PIXEL/USDT', 'PORTAL/USDT', 'SUPER/USDT', 'ALICE/USDT',
  'YGG/USDT', 'MAGIC/USDT', 'GMT/USDT', 'PYR/USDT', 'UFO/USDT',
  'SLP/USDT', 'LOKA/USDT', 'NAKA/USDT', 'GODS/USDT', 'IMX/USDT',
  'RON/USDT', 'WILD/USDT', 'BIGTIME/USDT', 'SHRAP/USDT', 'NYAN/USDT',
  'XAI/USDT', 'PIRATE/USDT', 'TREASURE/USDT', 'MYRIA/USDT', 'GAME/USDT',

  // =============================================
  // Infrastructure & Oracles (25)
  // =============================================
  'CHZ/USDT', 'ENS/USDT', 'MASK/USDT', 'SSV/USDT', 'API3/USDT',
  'BAND/USDT', 'STORJ/USDT', 'ANKR/USDT', 'TRB/USDT', 'RLC/USDT',
  'NKN/USDT', 'POLS/USDT', 'GLM/USDT', 'ACH/USDT', 'FLUX/USDT',
  'HNT/USDT', 'IOTX/USDT', 'DIA/USDT', 'POWR/USDT', 'AR/USDT',
  'FIL/USDT', 'AKASH/USDT', 'AKT/USDT', 'HONEY/USDT', 'RENDER/USDT',

  // =============================================
  // Exchange tokens (15)
  // =============================================
  'GT/USDT', 'KCS/USDT', 'HT/USDT', 'MX/USDT', 'BGB/USDT',
  'WOO/USDT', 'DEXE/USDT', 'FTT/USDT', 'COIN/USDT', 'BLUR/USDT',
  'LOOKS/USDT', 'X2Y2/USDT', 'SUDOSWAP/USDT', 'DODO/USDT', 'PERP/USDT',

  // =============================================
  // Bitcoin ecosystem (20)
  // =============================================
  'ORDI/USDT', 'SATS/USDT', 'RSR/USDT', 'BADGER/USDT', 'REN/USDT',
  'KEEP/USDT', 'MLN/USDT', 'PAXG/USDT', 'DOG/USDT', 'TRAC/USDT',
  'RARE/USDT', 'AUCTION/USDT', 'ALEX/USDT', 'STX/USDT', 'RUNES/USDT',
  'PIPE/USDT', 'STAMP/USDT', 'MUBI/USDT', 'PIZZA/USDT', 'ZBTC/USDT',

  // =============================================
  // Solana ecosystem (25)
  // =============================================
  'RAY/USDT', 'ORCA/USDT', 'MSOL/USDT', 'PYTH/USDT', 'JTO/USDT',
  'JITO/USDT', 'KMNO/USDT', 'DRIFT/USDT', 'FIDA/USDT', 'SRM/USDT',
  'STEP/USDT', 'MNDE/USDT', 'SLND/USDT', 'ATLAS/USDT', 'POLIS/USDT',
  'MARINADE/USDT', 'SOLEND/USDT', 'HUBBLE/USDT', 'SABER/USDT', 'TULIP/USDT',
  'PORT/USDT', 'SUNNY/USDT', 'COPE/USDT', 'MEDIA/USDT', 'SAMO/USDT',

  // =============================================
  // Cosmos ecosystem (15)
  // =============================================
  'TIA/USDT', 'DYM/USDT', 'NTRN/USDT', 'SCRT/USDT', 'KUJI/USDT',
  'STARS/USDT', 'JUNO/USDT', 'EVMOS/USDT', 'STRD/USDT', 'UMEE/USDT',
  'CMDX/USDT', 'SOMM/USDT', 'MARS/USDT', 'WHALE/USDT', 'FURY/USDT',

  // =============================================
  // RWA & Stablecoins (15)
  // =============================================
  'MKR/USDT', 'ONDO/USDT', 'MAPLE/USDT', 'GFI/USDT', 'CFG/USDT',
  'RIO/USDT', 'POLY/USDT', 'SNT/USDT', 'REQ/USDT', 'BOND/USDT',
  'FOREX/USDT', 'FDUSD/USDT', 'PYUSD/USDT', 'TUSD/USDT', 'GUSD/USDT',

  // =============================================
  // Other trending (20)
  // =============================================
  'CFX/USDT', 'JASMY/USDT', 'HOT/USDT', 'BTT/USDT', 'WIN/USDT',
  'JST/USDT', 'SUN/USDT', 'NFT/USDT', 'AGLD/USDT', 'LOOT/USDT',
  'PEOPLE/USDT', 'SPELL/USDT', 'SYN/USDT', 'ALPHA/USDT', 'BETA/USDT',
  'HERO/USDT', 'MBOX/USDT', 'DPETH/USDT', 'RETH/USDT', 'CBETH/USDT',

  // =============================================
  // BTC pairs (20 high volume)
  // =============================================
  'ETH/BTC', 'SOL/BTC', 'XRP/BTC', 'BNB/BTC', 'DOGE/BTC',
  'ADA/BTC', 'AVAX/BTC', 'DOT/BTC', 'LINK/BTC', 'LTC/BTC',
  'NEAR/BTC', 'UNI/BTC', 'APT/BTC', 'INJ/BTC', 'SUI/BTC',
  'OP/BTC', 'ARB/BTC', 'ATOM/BTC', 'FIL/BTC', 'MATIC/BTC',

  // =============================================
  // ETH pairs (15 high volume)
  // =============================================
  'SOL/ETH', 'BNB/ETH', 'LINK/ETH', 'MATIC/ETH', 'UNI/ETH',
  'AAVE/ETH', 'MKR/ETH', 'LDO/ETH', 'ARB/ETH', 'OP/ETH',
  'APT/ETH', 'INJ/ETH', 'NEAR/ETH', 'ATOM/ETH', 'FIL/ETH',

  // =============================================
  // Privacy & Anonymity (15)
  // =============================================
  'XMR/USDT', 'SCRT/USDT', 'DERO/USDT', 'FIRO/USDT', 'ARRR/USDT',
  'OXEN/USDT', 'NYM/USDT', 'PRE/USDT', 'RAIL/USDT', 'TORN/USDT',
  'AZERO/USDT', 'IRON/USDT', 'KEEP/USDT', 'NXM/USDT', 'CVP/USDT',

  // =============================================
  // SocialFi & Creator Economy (20)
  // =============================================
  'CYBER/USDT', 'HOOK/USDT', 'ID/USDT', 'LENS/USDT', 'GAL/USDT',
  'RSS3/USDT', 'DeSo/USDT', 'AUDIO/USDT', 'RAD/USDT', 'GTC/USDT',
  'DREP/USDT', 'PHB/USDT', 'FRONT/USDT', 'COMBO/USDT', 'EDU/USDT',
  'MAVIA/USDT', 'VANRY/USDT', 'MYRO/USDT', 'NFP/USDT', 'AI/USDT',

  // =============================================
  // DePIN & Physical Infrastructure (20)
  // =============================================
  'HNT/USDT', 'MOBILE/USDT', 'IOT/USDT', 'DIMO/USDT', 'WIFI/USDT',
  'RNDR/USDT', 'AKT/USDT', 'THETA/USDT', 'TFUEL/USDT', 'HONEY/USDT',
  'PEAQ/USDT', 'NATIX/USDT', 'ANYONE/USDT', 'GEODNET/USDT', 'XNET/USDT',
  'DAWN/USDT', 'HIVEMAPPER/USDT', 'NOSANA/USDT', 'RENDER/USDT', 'FLUX/USDT',

  // =============================================
  // Cross-chain & Bridges (15)
  // =============================================
  'WORMHOLE/USDT', 'STG/USDT', 'AXL/USDT', 'RUNE/USDT', 'MULTI/USDT',
  'CELR/USDT', 'HOP/USDT', 'ACROSS/USDT', 'LI.FI/USDT', 'SYNAPSE/USDT',
  'CCIP/USDT', 'ZRO/USDT', 'STARGATE/USDT', 'CELER/USDT', 'BRDG/USDT',

  // =============================================
  // 2025-2026 New Memecoins (30)
  // =============================================
  'VINE/USDT', 'JELLYJELLY/USDT', 'TST/USDT', 'BROCCOLI/USDT', 'BANANAS31/USDT',
  'RIZZMAS/USDT', 'ANIME/USDT', 'KABOSU/USDT', 'MOODENG/USDT', 'CHILL/USDT',
  'WEN/USDT', 'STONKS/USDT', 'LUCE/USDT', 'CHEEMS/USDT', 'SIGMA/USDT',
  'RIZZ/USDT', 'SKIBIDI/USDT', 'GYATT/USDT', 'OHIO/USDT', 'BODEN/USDT',
  'TREMP/USDT', 'HAWK/USDT', 'LUIGI/USDT', 'MFER/USDT', 'BASED/USDT',
  'WOJAK/USDT', 'CHAD/USDT', 'GIGACHAD/USDT', 'COPE/USDT', 'SNEK/USDT',

  // =============================================
  // New AI Tokens 2025-2026 (25)
  // =============================================
  'VIRTUAL/USDT', 'AI16Z/USDT', 'GRIFFAIN/USDT', 'ZEREBRO/USDT', 'ARC/USDT',
  'SWARMS/USDT', 'ELIZA/USDT', 'SENTAI/USDT', 'COOKIE/USDT', 'AIXBT/USDT',
  'ALCH/USDT', 'BULLY/USDT', 'LUNA2/USDT', 'AIMBOT/USDT', 'CLANKER/USDT',
  'MIND/USDT', 'CHAOS/USDT', 'NEURAL/USDT', 'SYNTH/USDT', 'CORTEX/USDT',
  'DEEPSEEK/USDT', 'GROK/USDT', 'GEMMA/USDT', 'LLAMA/USDT', 'MIXTRAL/USDT',

  // =============================================
  // Staking & Liquid Staking (15)
  // =============================================
  'LIDO/USDT', 'STETH/USDT', 'RETH/USDT', 'CBETH/USDT', 'SFRXETH/USDT',
  'MSOL/USDT', 'BNSOL/USDT', 'JITOSOL/USDT', 'EZETH/USDT', 'WEETH/USDT',
  'RSETH/USDT', 'PUFETH/USDT', 'EETH/USDT', 'OETH/USDT', 'SWETH/USDT',

  // =============================================
  // Perpetuals & DEX tokens (15)
  // =============================================
  'DYDX/USDT', 'GMX/USDT', 'GNS/USDT', 'KWENTA/USDT', 'VRTX/USDT',
  'DRIFT/USDT', 'AEVO/USDT', 'APEX/USDT', 'HMXORG/USDT', 'LEVEL/USDT',
  'MUX/USDT', 'GAINS/USDT', 'RABBY/USDT', 'ZETA/USDT', 'LYRA/USDT',

  // =============================================
  // Miscellaneous Altcoins (45)
  // =============================================
  'WLD/USDT', 'STRK/USDT', 'PIXEL/USDT', 'PORTAL/USDT', 'MANTA/USDT',
  'DYM/USDT', 'JUP/USDT', 'PYTH/USDT', 'JTO/USDT', 'TIA/USDT',
  'NTRN/USDT', 'ACE/USDT', 'XAI/USDT', 'ALT/USDT', 'MAVIA/USDT',
  'BOME/USDT', 'ETHFI/USDT', 'ENA/USDT', 'W/USDT', 'TNSR/USDT',
  'SAGA/USDT', 'OMNI/USDT', 'REZ/USDT', 'BB/USDT', 'NOT/USDT',
  'IO/USDT', 'ZK/USDT', 'LISTA/USDT', 'ZRO/USDT', 'BLAST/USDT',
  'ONDO/USDT', 'AERO/USDT', 'BANANA/USDT', 'SLN/USDT', 'NEIRO/USDT',
  'TURBO/USDT', 'DOGS/USDT', 'HMSTR/USDT', 'EIGEN/USDT', 'SCR/USDT',
  'MOODENG/USDT', 'GRASS/USDT', 'USUAL/USDT', 'MOVE/USDT', 'ME/USDT',

  // =============================================
  // Additional Memecoins 2025-2026 (25)
  // =============================================
  'BABYDOGE/USDT', 'LADYS/USDT', 'AIDOGE/USDT', 'BOB/USDT', 'TROLL/USDT',
  'MAGA2/USDT', 'PORK/USDT', 'SMOG/USDT', 'BRISE/USDT', 'LEASH/USDT',
  'BONE/USDT', 'VOLT/USDT', 'KISHU/USDT', 'AKITA/USDT', 'HOGE/USDT',
  'ELON/USDT', 'PIT/USDT', 'DINO/USDT', 'CATGIRL/USDT', 'CATE/USDT',
  'MUSHROOM/USDT', 'FROG/USDT', 'TSUKA/USDT', 'CULT/USDT', 'SHINJA/USDT',

  // =============================================
  // AI Agents & Infra 2025-2026 (25)
  // =============================================
  'NEUR/USDT', 'GOLEM/USDT', 'SINGULARITY/USDT', 'TARS/USDT', 'JARVIS/USDT',
  'NAVI/USDT', 'SPEC/USDT', 'PROMPT/USDT', 'AGENT/USDT', 'VANA/USDT',
  'MORPHEUS/USDT', 'BONSAI/USDT', 'KAITO/USDT', 'KIZUNA/USDT', 'ORBIT/USDT',
  'VAPOR/USDT', 'TENSOR/USDT', 'MYSHELL/USDT', 'BITTENSOR/USDT', 'RITUAL/USDT',
  'NOUS/USDT', 'MODULUS/USDT', 'SAKURA/USDT', 'SATORI/USDT', 'OPTIMUS/USDT',

  // =============================================
  // Trending Mid-caps 2025-2026 (20)
  // =============================================
  'PENDLE/USDT', 'MORPHO/USDT', 'AAVE/USDT', 'CRV/USDT', 'SNX/USDT',
  'RPL/USDT', 'COMP/USDT', 'BAL/USDT', 'SUSHI/USDT', 'CAKE/USDT',
  'QUICK/USDT', 'JOE/USDT', 'VELODROME/USDT', 'THENA/USDT', 'CAMELOT/USDT',
  'RADIANT/USDT', 'EXTRA/USDT', 'FRAXSHARE/USDT', 'PAXG/USDT', 'WBTC/USDT',

  // =============================================
  // Additional BTC & ETH cross-pairs (15)
  // =============================================
  'SHIB/BTC', 'FET/BTC', 'PEPE/BTC', 'WIF/BTC', 'BONK/BTC',
  'TIA/BTC', 'SEI/BTC', 'RENDER/BTC', 'FTM/BTC', 'ALGO/BTC',
  'SHIB/ETH', 'FET/ETH', 'DOGE/ETH', 'AVAX/ETH', 'DOT/ETH',
] as const;

/**
 * Minimum volume for BTC/ETH pairs (higher threshold)
 */
const MIN_VOLUME_BTC_ETH_USD = 500_000;

/**
 * Maximum symbols per exchange to avoid overwhelming connections
 */
const MAX_SYMBOLS_PER_EXCHANGE = 100;

/**
 * Delay between subscription batches (ms) - 2s for balanced rate limiting
 */
const SUBSCRIPTION_BATCH_DELAY_MS = 2000;

/**
 * Symbols per subscription batch - 10 for faster subscription
 */
const SUBSCRIPTION_BATCH_SIZE = 10;

/**
 * Refresh interval for active symbols (1.5 hours in ms)
 */
const REFRESH_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes

/**
 * Minimum 24h volume in USD to consider a pair liquid
 * Set to $30k to capture more opportunities while filtering noise
 */
const MIN_VOLUME_USD = 30_000;

/**
 * Maximum total symbols across all exchanges
 * If exceeded, take top symbols by exchange count
 */
const MAX_TOTAL_SYMBOLS = 800;

/**
 * Minimum pairs from exchange before using full fallback
 * If exchange returns fewer than this, use fallback completely
 */
const MIN_PAIRS_THRESHOLD = 30;

/**
 * Allowed quote currencies for trading pairs
 */
const ALLOWED_QUOTES = ['USDT', 'BTC', 'ETH'] as const;

/**
 * Patterns to exclude (leverage, perpetuals, futures, margin)
 */
const EXCLUDE_PATTERNS = [
  /杠杆/i, // Chinese for leverage
  /PERP/i,
  /FUTURES/i,
  /MARGIN/i,
  /SWAP/i,
  /_/,  // Often used for derivatives (e.g., BTC_USDT_PERP)
  /\d+L$/i,  // Leveraged tokens (e.g., BTC3L)
  /\d+S$/i,  // Short tokens (e.g., BTC3S)
  /UP$/i,    // Binance leveraged (BTCUP)
  /DOWN$/i,  // Binance leveraged (BTCDOWN)
  /BULL$/i,
  /BEAR$/i,
];

/**
 * Exchange connection interface (minimal for symbol manager)
 */
interface ExchangeConnection {
  id: string;
  fetchMarkets: () => Promise<Market[]>;
}

/**
 * Market info from CCXT
 */
interface Market {
  id: string;
  symbol: string;
  base: string;
  quote: string;
  active?: boolean;
  type?: string;
  spot?: boolean;
  info?: Record<string, unknown>;
}

/**
 * Symbol data with source information
 */
interface SymbolData {
  symbol: TradingSymbol;
  exchanges: Set<ExchangeId>;
  isDynamic: boolean;
  volume24h?: number;
}

/**
 * Symbol manager state
 */
interface SymbolManagerState {
  activeSymbols: Map<string, SymbolData>;
  exchangeSymbols: Map<ExchangeId, Set<TradingSymbol>>;
  lastRefresh: number;
  dynamicCount: number;
  fallbackCount: number;
  isInitialized: boolean;
}

// Global state
const state: SymbolManagerState = {
  activeSymbols: new Map(),
  exchangeSymbols: new Map(),
  lastRefresh: 0,
  dynamicCount: 0,
  fallbackCount: 0,
  isInitialized: false,
};

let refreshIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Check if a symbol should be excluded
 */
function shouldExcludeSymbol(symbol: string): boolean {
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(symbol));
}

/**
 * Get volume from market info (exchange-specific parsing)
 */
function getVolumeFromMarket(market: Market): number {
  const info = market.info;
  if (info === undefined) return 0;

  // Try common volume fields
  const volumeFields = [
    'quoteVolume',
    'quoteVolume24h',
    'volume24h',
    'turnover24h',
    'volumeUsd',
    'vol',
    'volume',
  ];

  for (const field of volumeFields) {
    const value = info[field];
    if (typeof value === 'number' && value > 0) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return 0;
}

/**
 * Fetch active symbols from a single exchange
 * Supports USDT, BTC, and ETH quote currencies
 */
async function fetchExchangeSymbols(
  exchangeId: ExchangeId,
  exchange: ExchangeConnection
): Promise<TradingSymbol[]> {
  try {
    logger.debug({ exchangeId }, 'Fetching markets');
    
    const markets = await exchange.fetchMarkets();
    const validSymbols: TradingSymbol[] = [];
    let usdtCount = 0;
    let btcCount = 0;
    let ethCount = 0;

    for (const market of markets) {
      // Skip inactive markets
      if (market.active === false) continue;

      // Only spot markets
      if (market.type !== 'spot' && market.spot !== true) continue;

      // Only allowed quote currencies
      const quote = market.quote;
      if (!ALLOWED_QUOTES.includes(quote as typeof ALLOWED_QUOTES[number])) continue;

      // Skip excluded patterns
      if (shouldExcludeSymbol(market.symbol)) continue;

      // Check volume (if available)
      const volume = getVolumeFromMarket(market);
      
      // Different volume thresholds for different quote currencies
      if (quote === 'USDT') {
        if (volume > 0 && volume < MIN_VOLUME_USD) continue;
        usdtCount++;
      } else if (quote === 'BTC' || quote === 'ETH') {
        // Higher volume threshold for BTC/ETH pairs
        if (volume > 0 && volume < MIN_VOLUME_BTC_ETH_USD) continue;
        if (quote === 'BTC') btcCount++;
        else ethCount++;
      }

      validSymbols.push(createTradingSymbol(market.base, market.quote));
    }

    logger.debug(
      { 
        exchangeId, 
        totalMarkets: markets.length, 
        validSymbols: validSymbols.length,
        usdtPairs: usdtCount,
        btcPairs: btcCount,
        ethPairs: ethCount,
      },
      'Filtered markets'
    );

    return validSymbols;
  } catch (error) {
    logger.warn(
      {
        exchangeId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to fetch markets, will use fallback'
    );
    return [];
  }
}

/**
 * Refresh active symbols from all exchanges
 */
export async function refreshActiveSymbols(
  exchanges: Map<ExchangeId, Exchange>
): Promise<void> {
  logger.info({ exchangeCount: exchanges.size }, 'Refreshing active symbols');

  const allSymbols = new Map<string, SymbolData>();
  const exchangeSymbolsMap = new Map<ExchangeId, Set<TradingSymbol>>();
  let dynamicCount = 0;
  let fallbackCount = 0;
  const fallbackExchanges: ExchangeId[] = [];

  // Fetch symbols from each exchange
  const fetchPromises = Array.from(exchanges.entries()).map(
    async ([exchangeId, exchange]) => {
      const symbols = await fetchExchangeSymbols(exchangeId, exchange as unknown as ExchangeConnection);
      return { exchangeId, symbols };
    }
  );

  const results = await Promise.allSettled(fetchPromises);

  // Process results
  for (const result of results) {
    if (result.status === 'rejected') continue;

    const { exchangeId, symbols } = result.value;
    const exchangeSymbols = new Set<TradingSymbol>();

    // Use fallback if exchange returned fewer than MIN_PAIRS_THRESHOLD pairs
    const useFallback = symbols.length < MIN_PAIRS_THRESHOLD;
    
    if (useFallback) {
      fallbackExchanges.push(exchangeId);
      logger.debug(
        { exchangeId, returnedPairs: symbols.length, threshold: MIN_PAIRS_THRESHOLD },
        `Exchange ${exchangeId} returned < ${MIN_PAIRS_THRESHOLD} pairs, using fallback`
      );
    }

    if (!useFallback && symbols.length > 0) {
      // Use dynamic symbols
      for (const symbol of symbols) {
        exchangeSymbols.add(symbol);

        const existing = allSymbols.get(symbol);
        if (existing !== undefined) {
          existing.exchanges.add(exchangeId);
        } else {
          allSymbols.set(symbol, {
            symbol,
            exchanges: new Set([exchangeId]),
            isDynamic: true,
          });
          dynamicCount++;
        }
      }
    } else {
      // Use fallback symbols for this exchange
      for (const symbolStr of FALLBACK_SYMBOLS) {
        const symbol = symbolStr as TradingSymbol;
        exchangeSymbols.add(symbol);

        const existing = allSymbols.get(symbol);
        if (existing !== undefined) {
          existing.exchanges.add(exchangeId);
        } else {
          allSymbols.set(symbol, {
            symbol,
            exchanges: new Set([exchangeId]),
            isDynamic: false,
          });
          fallbackCount++;
        }
      }
    }

    exchangeSymbolsMap.set(exchangeId, exchangeSymbols);
  }

  // Limit total symbols to MAX_TOTAL_SYMBOLS if exceeded
  if (allSymbols.size > MAX_TOTAL_SYMBOLS) {
    logger.info(
      { currentTotal: allSymbols.size, limit: MAX_TOTAL_SYMBOLS },
      `Total symbols (${allSymbols.size}) exceeds limit, trimming to top ${MAX_TOTAL_SYMBOLS}`
    );

    // Sort by number of exchanges (prioritize symbols on more exchanges)
    const sortedSymbols = Array.from(allSymbols.entries())
      .sort((a, b) => b[1].exchanges.size - a[1].exchanges.size)
      .slice(0, MAX_TOTAL_SYMBOLS);

    const trimmedSymbols = new Map(sortedSymbols);
    
    // Update exchange symbols maps to only include trimmed symbols
    for (const [exchangeId, symbols] of exchangeSymbolsMap) {
      const filteredSymbols = new Set<TradingSymbol>();
      for (const symbol of symbols) {
        if (trimmedSymbols.has(symbol)) {
          filteredSymbols.add(symbol);
        }
      }
      exchangeSymbolsMap.set(exchangeId, filteredSymbols);
    }

    // Recalculate counts
    dynamicCount = 0;
    fallbackCount = 0;
    for (const data of trimmedSymbols.values()) {
      if (data.isDynamic) {
        dynamicCount++;
      } else {
        fallbackCount++;
      }
    }

    state.activeSymbols = trimmedSymbols;
  } else {
    state.activeSymbols = allSymbols;
  }

  // Update state
  state.exchangeSymbols = exchangeSymbolsMap;
  state.lastRefresh = Date.now();
  state.dynamicCount = dynamicCount;
  state.fallbackCount = fallbackCount;
  state.isInitialized = true;

  // Build symbols per exchange summary
  const symbolsPerExchange: string[] = [];
  for (const [exchId, symbols] of exchangeSymbolsMap) {
    symbolsPerExchange.push(`${exchId}: ${symbols.size}`);
  }

  // Log summary with requested format
  const healthyExchanges = exchangeSymbolsMap.size;
  logger.info(
    {
      totalSymbols: state.activeSymbols.size,
      dynamicCount,
      fallbackCount,
      healthyExchanges,
      fallbackExchanges: fallbackExchanges.length > 0 ? fallbackExchanges : undefined,
    },
    `Loaded ${state.activeSymbols.size} symbols from ${healthyExchanges} exchanges`
  );

  // Log symbols per exchange
  logger.info(
    { symbolsPerExchange: Object.fromEntries(Array.from(exchangeSymbolsMap.entries()).map(([k, v]) => [k, v.size])) },
    `Symbols per exchange: ${symbolsPerExchange.join(', ')}`
  );
}

/**
 * Get all active symbols
 */
export function getActiveSymbols(): TradingSymbol[] {
  return Array.from(state.activeSymbols.keys()) as TradingSymbol[];
}

/**
 * Get symbols for a specific exchange (limited to MAX_SYMBOLS_PER_EXCHANGE)
 */
export function getExchangeSymbols(exchangeId: ExchangeId): TradingSymbol[] {
  const symbols = state.exchangeSymbols.get(exchangeId);
  if (symbols === undefined) {
    // Return fallback if exchange not found
    return FALLBACK_SYMBOLS.slice(0, MAX_SYMBOLS_PER_EXCHANGE) as TradingSymbol[];
  }

  const symbolArray = Array.from(symbols);
  
  // Prioritize symbols present on multiple exchanges (better for arbitrage)
  symbolArray.sort((a, b) => {
    const aData = state.activeSymbols.get(a);
    const bData = state.activeSymbols.get(b);
    const aExchanges = aData?.exchanges.size ?? 0;
    const bExchanges = bData?.exchanges.size ?? 0;
    return bExchanges - aExchanges; // More exchanges first
  });

  return symbolArray.slice(0, MAX_SYMBOLS_PER_EXCHANGE);
}

/**
 * Get symbols that exist on multiple exchanges (best for arbitrage)
 */
export function getArbitrageSymbols(minExchanges = 2): TradingSymbol[] {
  const result: TradingSymbol[] = [];

  for (const [symbol, data] of state.activeSymbols) {
    if (data.exchanges.size >= minExchanges) {
      result.push(symbol as TradingSymbol);
    }
  }

  // Sort by number of exchanges (more = better for arbitrage)
  result.sort((a, b) => {
    const aExchanges = state.activeSymbols.get(a)?.exchanges.size ?? 0;
    const bExchanges = state.activeSymbols.get(b)?.exchanges.size ?? 0;
    return bExchanges - aExchanges;
  });

  return result;
}

/**
 * Get common symbols across all specified exchanges
 */
export function getCommonSymbols(exchangeIds: ExchangeId[]): TradingSymbol[] {
  if (exchangeIds.length === 0) return [];

  const firstExchange = exchangeIds[0];
  if (firstExchange === undefined) return [];
  
  const firstSymbols = state.exchangeSymbols.get(firstExchange);
  if (firstSymbols === undefined) return [];

  const common = new Set(firstSymbols);

  for (let i = 1; i < exchangeIds.length; i++) {
    const exchangeId = exchangeIds[i];
    if (exchangeId === undefined) continue;
    
    const exchangeSymbols = state.exchangeSymbols.get(exchangeId);
    if (exchangeSymbols === undefined) continue;

    for (const symbol of common) {
      if (!exchangeSymbols.has(symbol)) {
        common.delete(symbol);
      }
    }
  }

  return Array.from(common);
}

/**
 * Subscribe to symbols with staggered batches
 * Subscribes in batches of 5 symbols every 1500ms to avoid rate limits
 */
export async function subscribeWithDelay(
  subscribeFunc: (symbol: TradingSymbol) => void,
  symbols: TradingSymbol[],
  options: { batchSize?: number; batchDelayMs?: number } = {}
): Promise<void> {
  const { batchSize = SUBSCRIPTION_BATCH_SIZE, batchDelayMs = SUBSCRIPTION_BATCH_DELAY_MS } = options;

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(symbols.length / batchSize);

    // Subscribe to this batch
    for (const symbol of batch) {
      try {
        subscribeFunc(symbol);
      } catch (error) {
        logger.warn(
          {
            symbol,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to subscribe to symbol'
        );
      }
    }

    // Log batch progress periodically
    if (batchNum === 1 || batchNum % 5 === 0 || batchNum === totalBatches) {
      logger.debug(
        { batchNum, totalBatches, symbolsSubscribed: Math.min(i + batchSize, symbols.length) },
        `Subscription batch ${batchNum}/${totalBatches}`
      );
    }

    // Delay before next batch (skip if last batch)
    if (i + batchSize < symbols.length && batchDelayMs > 0) {
      await sleep(batchDelayMs);
    }
  }
}

/**
 * Initialize symbol manager with periodic refresh
 */
export async function initSymbols(exchanges: Map<ExchangeId, Exchange>): Promise<void> {
  logger.info(
    { 
      exchangeCount: exchanges.size,
      minVolumeUsd: MIN_VOLUME_USD,
      minVolumeBtcEthUsd: MIN_VOLUME_BTC_ETH_USD,
      maxSymbolsPerExchange: MAX_SYMBOLS_PER_EXCHANGE,
      maxTotalSymbols: MAX_TOTAL_SYMBOLS,
      minPairsThreshold: MIN_PAIRS_THRESHOLD,
      fallbackSymbolCount: FALLBACK_SYMBOLS.length,
      allowedQuotes: ALLOWED_QUOTES,
    },
    'Initializing symbol manager'
  );

  // Initial refresh
  await refreshActiveSymbols(exchanges);

  // Set up periodic refresh
  if (refreshIntervalId !== null) {
    clearInterval(refreshIntervalId);
  }

  refreshIntervalId = setInterval(() => {
    refreshActiveSymbols(exchanges).catch((error) => {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to refresh symbols'
      );
    });
  }, REFRESH_INTERVAL_MS);

  const refreshHours = REFRESH_INTERVAL_MS / (60 * 60 * 1000);
  const arbitrageCount = Array.from(state.activeSymbols.values()).filter(d => d.exchanges.size >= 2).length;
  
  logger.info(
    { 
      refreshIntervalHours: refreshHours,
      refreshIntervalMs: REFRESH_INTERVAL_MS,
      totalSymbols: state.activeSymbols.size,
      arbitrageSymbols: arbitrageCount,
      exchangeCount: state.exchangeSymbols.size,
    },
    `Symbol manager initialized: ${state.activeSymbols.size} symbols from ${state.exchangeSymbols.size} exchanges, refresh every ${refreshHours}h`
  );
}

/**
 * Stop symbol manager (cleanup)
 */
export function stopSymbolManager(): void {
  if (refreshIntervalId !== null) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }

  logger.info('Symbol manager stopped');
}

/**
 * Register connected exchanges that may not have been in the initial fetch.
 * Ensures all healthy exchanges are tracked with fallback symbols so stats
 * reflect the actual number of exchanges and symbols being scanned.
 * Call AFTER initSymbols() and after exchanges have connected.
 */
export function registerConnectedExchanges(exchangeIds: ExchangeId[]): void {
  let newExchanges = 0;
  let newSymbols = 0;

  for (const exchangeId of exchangeIds) {
    // Skip if this exchange already has symbols in state
    if (state.exchangeSymbols.has(exchangeId)) continue;

    newExchanges++;
    const exchangeSymbols = new Set<TradingSymbol>();

    // Add all fallback symbols for this exchange
    for (const symbolStr of FALLBACK_SYMBOLS) {
      const symbol = symbolStr as TradingSymbol;
      exchangeSymbols.add(symbol);

      const existing = state.activeSymbols.get(symbol);
      if (existing !== undefined) {
        existing.exchanges.add(exchangeId);
      } else {
        state.activeSymbols.set(symbol, {
          symbol,
          exchanges: new Set([exchangeId]),
          isDynamic: false,
        });
        newSymbols++;
        state.fallbackCount++;
      }
    }

    state.exchangeSymbols.set(exchangeId, exchangeSymbols);
  }

  if (newExchanges > 0) {
    logger.info(
      {
        newExchanges,
        newSymbols,
        totalSymbols: state.activeSymbols.size,
        totalExchanges: state.exchangeSymbols.size,
      },
      `Registered ${newExchanges} additional exchanges with fallback symbols (${newSymbols} new symbols)`
    );
  }
}

/**
 * Get symbol manager stats
 */
export function getSymbolManagerStats(): {
  totalSymbols: number;
  dynamicCount: number;
  fallbackCount: number;
  exchangeCount: number;
  lastRefresh: number;
  isInitialized: boolean;
  arbitrageSymbols: number; // Symbols on 2+ exchanges
} {
  const arbitrageSymbols = Array.from(state.activeSymbols.values()).filter(
    (data) => data.exchanges.size >= 2
  ).length;

  return {
    totalSymbols: state.activeSymbols.size,
    dynamicCount: state.dynamicCount,
    fallbackCount: state.fallbackCount,
    exchangeCount: state.exchangeSymbols.size,
    lastRefresh: state.lastRefresh,
    isInitialized: state.isInitialized,
    arbitrageSymbols,
  };
}

/**
 * Get fallback symbols (for direct use when needed)
 * @param limit - optional limit, defaults to MAX_SYMBOLS_PER_EXCHANGE (25)
 */
export function getFallbackSymbols(limit = MAX_SYMBOLS_PER_EXCHANGE): TradingSymbol[] {
  return FALLBACK_SYMBOLS.slice(0, limit) as TradingSymbol[];
}

/**
 * Get all fallback symbols (full list of 150+)
 */
export function getAllFallbackSymbols(): TradingSymbol[] {
  return [...FALLBACK_SYMBOLS] as TradingSymbol[];
}

/**
 * Check if a symbol is active
 */
export function isSymbolActive(symbol: TradingSymbol): boolean {
  return state.activeSymbols.has(symbol);
}

/**
 * Get exchanges that support a symbol
 */
export function getSymbolExchanges(symbol: TradingSymbol): ExchangeId[] {
  const data = state.activeSymbols.get(symbol);
  return data !== undefined ? Array.from(data.exchanges) : [];
}
