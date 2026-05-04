import { LegalLayout } from './LegalLayout';

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="April 30, 2026">
      <p>
        This Privacy Policy explains how Right Order (&quot;we&quot;, &quot;us&quot;) collects, uses, and shares personal
        data when you use our SaaS platform. We comply with the EU General Data Protection Regulation
        (GDPR) and similar privacy frameworks. For requests, contact{' '}
        <a className="underline" href="mailto:support@rightorder.io">support@rightorder.io</a>.
      </p>

      <h2 className="text-lg font-semibold pt-4">1. Data We Collect</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Account data:</strong> email address, hashed password, role, subscription tier, created/updated timestamps.</li>
        <li><strong>Authentication data:</strong> refresh-token records (token, IP, user-agent, expiry) for session management; 2FA secrets if enabled.</li>
        <li><strong>Usage data:</strong> request logs, feature usage, pages viewed, error reports.</li>
        <li><strong>Payment data:</strong> handled by Stripe — we receive a customer ID and the last 4 digits of the card from Stripe; we never see the full card number. For crypto payments we store the deposit address shown to you and the on-chain transaction hash you submit.</li>
        <li><strong>Preferences:</strong> deposit-size, default tab, theme, auto-refresh interval.</li>
      </ul>

      <h2 className="text-lg font-semibold pt-4">2. Legal Basis for Processing (GDPR Art. 6)</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Contract:</strong> we process account, authentication, and subscription data to provide the Service you signed up for.</li>
        <li><strong>Legitimate interest:</strong> security logging, fraud prevention, debugging, and product analytics.</li>
        <li><strong>Legal obligation:</strong> retention of payment records for tax/accounting where required.</li>
        <li><strong>Consent:</strong> non-essential cookies and marketing emails (you may withdraw consent at any time).</li>
      </ul>

      <h2 className="text-lg font-semibold pt-4">3. Sub-processors</h2>
      <p>We share the minimum necessary data with the following sub-processors:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Stripe</strong> — payment processing (card billing, subscription management). See <a className="underline" href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">stripe.com/privacy</a>.</li>
        <li><strong>Hosting / database providers</strong> — for application hosting and PostgreSQL persistence.</li>
        <li><strong>Email provider</strong> — for transactional email (account verification, password reset, billing receipts).</li>
        <li><strong>Telegram</strong> — only if you opt-in to alert delivery to a Telegram chat.</li>
      </ul>

      <h2 className="text-lg font-semibold pt-4">4. Cookies and Tracking</h2>
      <p>We use:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Essential cookies / local storage:</strong> JWT access token, refresh token, theme preference. Required for the Service to function — you cannot opt out without losing access.</li>
        <li><strong>Analytics cookies:</strong> only loaded after you accept the cookie banner. Used to measure aggregate feature usage.</li>
      </ul>
      <p>
        Set or change your preference any time by clearing browser storage and reloading; the consent banner
        will reappear.
      </p>

      <h2 className="text-lg font-semibold pt-4">5. Data Retention</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>Account data: kept while your account is active, plus 30 days after deletion.</li>
        <li>Refresh-token records: 30 days from issuance.</li>
        <li>Payment records: at least 7 years where required by tax law.</li>
        <li>Application logs: 90 days rolling.</li>
      </ul>

      <h2 className="text-lg font-semibold pt-4">6. Your Rights (GDPR / UK GDPR)</h2>
      <p>You have the right to: access your data, correct it, delete it, restrict processing, object to processing, port your data, and lodge a complaint with your local data-protection authority. Email{' '}
        <a className="underline" href="mailto:support@rightorder.io">support@rightorder.io</a> from the email tied to your account and we will respond within 30 days.
      </p>

      <h2 className="text-lg font-semibold pt-4">7. International Transfers</h2>
      <p>
        Sub-processors may process data outside the EEA. Where required, we rely on Standard Contractual
        Clauses or equivalent safeguards.
      </p>

      <h2 className="text-lg font-semibold pt-4">8. Security</h2>
      <p>
        Passwords are hashed with bcrypt. Sessions use short-lived JWT access tokens with rotated refresh
        tokens. TLS is enforced in transit. No system is perfectly secure — promptly report any suspected
        incident to <a className="underline" href="mailto:support@rightorder.io">support@rightorder.io</a>.
      </p>

      <h2 className="text-lg font-semibold pt-4">9. Children</h2>
      <p>The Service is not directed at children under 18. We do not knowingly collect data from minors.</p>

      <h2 className="text-lg font-semibold pt-4">10. Changes</h2>
      <p>
        Material updates to this policy will be announced in-app or by email at least 14 days before taking
        effect.
      </p>

      <h2 className="text-lg font-semibold pt-4">11. Contact</h2>
      <p>
        Data Protection contact: <a className="underline" href="mailto:support@rightorder.io">support@rightorder.io</a>.
      </p>
    </LegalLayout>
  );
}
