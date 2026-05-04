import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';

const STORAGE_KEY = 'cookieConsent.v1';

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (!v) setVisible(true);
    } catch {
      // localStorage unavailable — leave banner hidden rather than crash.
    }
  }, []);

  const decide = (decision: 'accepted' | 'declined') => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ decision, ts: Date.now() }));
    } catch {
      // Ignore — banner will reappear next load if storage is blocked.
    }
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-3xl rounded-2xl border border-white/10 bg-black/80 backdrop-blur-md p-4 md:p-5 shadow-2xl"
          role="dialog"
          aria-label="Cookie consent"
        >
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            <p className="flex-1 text-xs md:text-sm text-foreground/85 leading-relaxed">
              We use essential cookies and local storage so the app works (login session, preferences).
              With your consent we also use analytics cookies to measure feature usage. See our{' '}
              <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
            </p>
            <div className="flex gap-2 self-stretch md:self-auto">
              <button
                onClick={() => decide('declined')}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
              >
                Essential only
              </button>
              <button
                onClick={() => decide('accepted')}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Accept all
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
