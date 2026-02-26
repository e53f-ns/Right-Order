import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth, apiLogin, apiRegister } from '@/store/useAuth';
import { ArrowLeft, Loader2 } from 'lucide-react';

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { loading, error } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'register' && password !== confirmPassword) {
      useAuth.getState().setError('Passwords do not match');
      return;
    }
    const result = mode === 'login'
      ? await apiLogin(email, password)
      : await apiRegister(email, password);
    if (result.success) {
      navigate('/dashboard');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-primary/[0.03] blur-[120px]" />
      </div>

      <motion.div
        className="w-full max-w-[400px] relative"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        {/* Back link */}
        <button
          onClick={() => navigate('/')}
          className="btn-ghost px-3 py-1.5 rounded-lg text-xs text-muted-foreground mb-6 inline-flex items-center gap-1.5"
        >
          <ArrowLeft size={12} /> Back to home
        </button>

        <div className="glass-card rounded-2xl p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <h1 className="text-xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-heading)' }}>
              Right Order
            </h1>
            <p className="text-xs text-muted-foreground mt-1.5">
              {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
            </p>
          </div>

          {/* Tabs */}
          <div className="flex rounded-lg overflow-hidden border border-border mb-6">
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); useAuth.getState().setError(null); }}
                className={`flex-1 py-2 text-xs font-medium transition-colors relative ${
                  mode === m
                    ? 'bg-primary/10 text-primary'
                    : 'bg-white/[0.02] text-muted-foreground hover:text-foreground'
                }`}
              >
                {m === 'login' ? 'Sign In' : 'Register'}
                {mode === m && (
                  <motion.div
                    layoutId="auth-tab"
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 overflow-hidden"
              >
                <div className="px-3 py-2.5 rounded-lg text-xs bg-red-500/8 text-red-400 border border-red-500/15">
                  {error}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form */}
          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1.5 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="input-field"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium mb-1.5 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                required
                minLength={6}
                className="input-field"
              />
            </div>
            <AnimatePresence>
              {mode === 'register' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <label className="text-[11px] text-muted-foreground font-medium mb-1.5 block">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    required
                    minLength={6}
                    className="input-field"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              type="submit"
              disabled={loading}
              className="w-full btn-primary py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              whileTap={{ scale: 0.98 }}
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {mode === 'login' ? 'Signing in...' : 'Creating account...'}
                </>
              ) : (
                mode === 'login' ? 'Sign In' : 'Create Account'
              )}
            </motion.button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 divider-gradient" />
            <span className="text-[10px] text-muted-foreground/50">or</span>
            <div className="flex-1 divider-gradient" />
          </div>

          {/* Guest access */}
          <button
            onClick={() => {
              useAuth.getState().setAuth(
                { id: 'guest', email: 'guest@demo.com', createdAt: Date.now(), subscription: 'free', pro: false, preferences: { depositSize: 1000, favoriteSpreads: [], defaultTab: 'spreads', autoRefreshSec: 30, theme: 'dark' } },
                'guest-token'
              );
              navigate('/dashboard');
            }}
            className="w-full btn-secondary py-2 rounded-xl text-xs font-medium"
          >
            Continue as Guest
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-muted-foreground/40 mt-4">
          By signing in, you agree to our Terms of Service
        </p>
      </motion.div>
    </div>
  );
}
