import { LegalLayout } from './LegalLayout';

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="April 30, 2026">
      <h2 className="text-lg font-semibold pt-4">1. Acceptance of Terms</h2>
      <p>
        By creating an account, accessing, or using Right Order (&quot;Service&quot;), you agree to be bound by these
        Terms of Service. If you do not agree, do not use the Service. The Service is operated by Right Order
        (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;).
      </p>

      <h2 className="text-lg font-semibold pt-4">2. Description of Service</h2>
      <p>
        Right Order is a software-as-a-service (SaaS) platform that aggregates publicly available market data
        from cryptocurrency exchanges and decentralized exchanges, surfaces price differences (&quot;spreads&quot;), and
        provides analytical tooling. <strong>The Service is informational only and does not execute trades on
        your behalf, custody funds, or provide brokerage services.</strong>
      </p>

      <h2 className="text-lg font-semibold pt-4">3. Eligibility</h2>
      <p>
        You must be at least 18 years old and legally capable of entering binding contracts in your
        jurisdiction. You are responsible for ensuring that your use of the Service is lawful where you reside.
        The Service is not offered to residents of jurisdictions where cryptocurrency-related services are
        prohibited.
      </p>

      <h2 className="text-lg font-semibold pt-4">4. Accounts and Security</h2>
      <p>
        You are responsible for maintaining the confidentiality of your login credentials and for all
        activity under your account. Notify us immediately at <a className="underline" href="mailto:support@rightorder.io">support@rightorder.io</a>
        {' '}if you suspect unauthorized access. We may suspend or terminate accounts that violate these Terms.
      </p>

      <h2 className="text-lg font-semibold pt-4">5. Subscriptions and Billing</h2>
      <p>
        Paid plans (Pro, Elite, Ultimate) are billed in advance on a recurring monthly or annual basis through
        Stripe or, where supported, in USDT via TRC20/ERC20/TON. Subscriptions auto-renew until cancelled.
        You may cancel at any time from your profile; cancellation takes effect at the end of the current
        billing period. Crypto top-ups and one-time payments are non-refundable. Card-based subscription
        refunds are handled case-by-case at our discretion within 7 days of the charge.
      </p>

      <h2 className="text-lg font-semibold pt-4">6. Acceptable Use</h2>
      <p>
        You agree not to (a) reverse-engineer, scrape, or resell the Service; (b) use the Service to violate
        sanctions, anti-money-laundering, or securities laws; (c) abuse rate limits, attempt to disrupt our
        infrastructure, or probe for vulnerabilities without prior written authorization; (d) impersonate
        another person or misrepresent your affiliation.
      </p>

      <h2 className="text-lg font-semibold pt-4">7. No Investment Advice</h2>
      <p>
        Information surfaced by the Service is not financial, investment, tax, or legal advice. See our
        {' '}<a className="underline" href="/risk">Risk Disclaimer</a> for details. You are solely responsible for any
        decisions you make based on data shown in the Service.
      </p>

      <h2 className="text-lg font-semibold pt-4">8. Third-Party Data</h2>
      <p>
        The Service depends on data feeds from third-party exchanges, RPC providers, and analytics APIs.
        We do not guarantee that this data is accurate, complete, real-time, or uninterrupted. Latency,
        outages, and exchange-side errors will occur.
      </p>

      <h2 className="text-lg font-semibold pt-4">9. Disclaimer of Warranties</h2>
      <p>
        THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
        IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
      </p>

      <h2 className="text-lg font-semibold pt-4">10. Limitation of Liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, RIGHT ORDER&apos;S AGGREGATE LIABILITY FOR ANY CLAIM ARISING
        OUT OF OR RELATING TO THE SERVICE IS LIMITED TO THE AMOUNT YOU PAID US IN THE 12 MONTHS PRECEDING
        THE EVENT GIVING RISE TO THE CLAIM. WE ARE NOT LIABLE FOR INDIRECT, INCIDENTAL, CONSEQUENTIAL, OR
        LOST-PROFIT DAMAGES, INCLUDING TRADING LOSSES.
      </p>

      <h2 className="text-lg font-semibold pt-4">11. Termination</h2>
      <p>
        We may suspend or terminate your access at any time for breach of these Terms or for legal, security,
        or operational reasons. You may terminate your account at any time by contacting support.
      </p>

      <h2 className="text-lg font-semibold pt-4">12. Changes to Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be announced in-app or by email
        at least 14 days before they take effect. Continued use after the effective date constitutes
        acceptance.
      </p>

      <h2 className="text-lg font-semibold pt-4">13. Governing Law</h2>
      <p>
        These Terms are governed by the laws applicable to the entity operating the Service, without regard
        to conflict-of-laws principles. Disputes will be resolved by binding arbitration except where
        prohibited by law.
      </p>

      <h2 className="text-lg font-semibold pt-4">14. Contact</h2>
      <p>
        Questions or notices: <a className="underline" href="mailto:support@rightorder.io">support@rightorder.io</a>.
      </p>
    </LegalLayout>
  );
}
