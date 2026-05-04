import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export function LegalLayout({ title, lastUpdated, children }: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/[0.04] px-6 py-4 flex items-center justify-between">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} /> Back to home
        </button>
        <a href="mailto:support@rightorder.io" className="text-xs text-muted-foreground hover:text-foreground">
          support@rightorder.io
        </a>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>{title}</h1>
        <p className="text-xs text-muted-foreground mb-8">Last updated: {lastUpdated}</p>
        <div className="prose prose-invert max-w-none text-sm leading-relaxed space-y-4 text-foreground/85">
          {children}
        </div>
      </main>

      <footer className="border-t border-white/[0.04] py-6 px-6 text-center text-xs text-muted-foreground/60">
        <div className="flex flex-wrap justify-center gap-4">
          <button onClick={() => navigate('/terms')} className="hover:text-foreground">Terms</button>
          <button onClick={() => navigate('/privacy')} className="hover:text-foreground">Privacy</button>
          <button onClick={() => navigate('/risk')} className="hover:text-foreground">Risk Disclaimer</button>
          <a href="mailto:support@rightorder.io" className="hover:text-foreground">Contact support</a>
        </div>
        <div className="mt-3">&copy; 2026 Right Order. All rights reserved.</div>
      </footer>
    </div>
  );
}
