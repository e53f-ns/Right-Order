import { LegalLayout } from './LegalLayout';

export function RiskPage() {
  return (
    <LegalLayout title="Risk Disclaimer" lastUpdated="April 30, 2026">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-amber-200/90">
        <strong>Right Order is a market-data and analytics tool. It is not investment advice, not a
        broker, not a custodian, and not a regulated financial institution.</strong>
      </div>

      <h2 className="text-lg font-semibold pt-4">No Financial Advice</h2>
      <p>
        All information displayed in the Service — including spreads, funding rates, statistical
        signals, opportunities, AI assistant outputs, and historical analysis — is provided for
        informational and educational purposes only. Nothing in the Service constitutes financial,
        investment, legal, tax, or accounting advice, or a recommendation to buy, sell, or hold any
        asset. <strong>You are solely responsible for your trading decisions.</strong>
      </p>

      <h2 className="text-lg font-semibold pt-4">Cryptocurrency Risk</h2>
      <p>
        Cryptocurrency markets are highly volatile, largely unregulated, and operate 24/7. Risks include but
        are not limited to:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Total loss of capital — prices can move 50%+ in hours.</li>
        <li>Exchange insolvency, withdrawal halts, hacks, or rug pulls.</li>
        <li>Smart-contract bugs, oracle failures, and MEV / sandwich attacks on DEX trades.</li>
        <li>Stablecoin de-pegs (e.g. USDT, USDC) and bridge exploits.</li>
        <li>Regulatory action that may freeze assets, force delistings, or block access in your jurisdiction.</li>
        <li>Slippage, partial fills, and failed transfers between exchanges that wipe out arbitrage spreads.</li>
        <li>Network congestion that pushes gas fees above expected profit.</li>
      </ul>

      <h2 className="text-lg font-semibold pt-4">Data Limitations</h2>
      <p>
        Spread, depth, and price data are aggregated from third-party APIs and may be delayed,
        incorrect, or stale. By the time a spread reaches your screen, it may already be gone. Funding
        rates, statistical signals, and pairs-trading signals are computed from rolling windows that may
        not reflect current market structure. Historical performance does not predict future results.
      </p>

      <h2 className="text-lg font-semibold pt-4">Arbitrage-Specific Risk</h2>
      <p>
        &quot;Arbitrage&quot; opportunities surfaced by Right Order are <em>theoretical gross spreads</em>.
        Real-world execution must account for: trading fees, withdrawal fees, network fees, transfer
        latency (USDT TRC20: 1-3 min; ETH ERC20: 2-15+ min), KYC/withdrawal limits, frozen withdrawals,
        order-book depth on both legs, and execution slippage. Many displayed spreads cannot be captured
        profitably by retail users.
      </p>

      <h2 className="text-lg font-semibold pt-4">AI / LLM Output</h2>
      <p>
        The AI assistant uses large language models that can produce inaccurate, outdated, or fabricated
        information (&quot;hallucinations&quot;). Treat AI output as a starting point for your own research, never
        as a final answer.
      </p>

      <h2 className="text-lg font-semibold pt-4">Tax and Compliance</h2>
      <p>
        Cryptocurrency activity may have tax consequences in your jurisdiction. Right Order does not
        track your trading activity for tax purposes and does not provide tax reports. Consult a
        qualified tax professional.
      </p>

      <h2 className="text-lg font-semibold pt-4">Geographic Restrictions</h2>
      <p>
        It is your responsibility to ensure that using cryptocurrency exchanges and the Service is legal in
        your country and on the platforms you connect to. Right Order does not facilitate access to any
        sanctioned jurisdiction.
      </p>

      <h2 className="text-lg font-semibold pt-4">Acknowledgment</h2>
      <p>
        By using Right Order you acknowledge that you have read and understood these risks, that you are
        capable of evaluating them, and that you accept responsibility for any losses resulting from your
        use of information surfaced by the Service.
      </p>

      <p className="pt-4">
        Questions: <a className="underline" href="mailto:support@rightorder.io">support@rightorder.io</a>.
      </p>
    </LegalLayout>
  );
}
