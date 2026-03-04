import { create } from 'zustand';

export type SubscriptionPlan = 'free' | 'pro' | 'elite' | 'ultimate';
export type UserRole = 'user' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  role?: UserRole;
  createdAt: number;
  subscription: SubscriptionPlan;
  subscriptionExpiresAt?: number;
  pro: boolean;
  twoFactorEnabled?: boolean;
  preferences: {
    depositSize: number;
    favoriteSpreads?: string[];
    defaultTab: string;
    autoRefreshSec: number;
    theme: 'dark' | 'light';
  };
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  setAuth: (user: AuthUser, token: string) => void;
  clearAuth: () => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  updatePreferences: (prefs: Partial<AuthUser['preferences']>) => void;
  updateSubscription: (plan: SubscriptionPlan, expiresAt?: number) => void;
}

const TOKEN_KEY = 'ro_auth_token';

interface ApiErrorLike {
  success?: boolean;
  error?: string;
  code?: string;
  retry_after?: number;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  token: typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null,
  loading: false,
  error: null,

  setAuth: (user, token) => {
    localStorage.setItem(TOKEN_KEY, token);
    set({ user, token, error: null });
  },

  clearAuth: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ user: null, token: null, error: null });
  },

  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),

  updatePreferences: (prefs) => {
    const { user } = get();
    if (!user) return;
    set({ user: { ...user, preferences: { ...user.preferences, ...prefs } } });
  },

  updateSubscription: (plan, expiresAt) => {
    const { user } = get();
    if (!user) return;
    set({ user: { ...user, subscription: plan, subscriptionExpiresAt: expiresAt, pro: plan !== 'free' } });
  },
}));

// ---- API helpers (credentials: 'include' for HttpOnly refresh cookie) ----

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function messageForAuthFailure(res: Response, json: ApiErrorLike | null, fallback: string): string {
  if (json?.error) return json.error;
  if (res.status === 409) return 'Email already registered';
  if (res.status === 429) return 'Too many attempts. Please try again later.';
  if (res.status === 503) return 'Server is temporarily unavailable. Please try again in a minute.';
  return fallback;
}

export async function apiLogin(email: string, password: string): Promise<{ success: boolean; error?: string }> {
  useAuth.getState().setLoading(true);
  useAuth.getState().setError(null);
  try {
    console.info('[auth.login] request', { email: email.trim().toLowerCase() });
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const json = await readJsonSafe<ApiErrorLike & { user?: AuthUser; token?: string; requiresVerification?: boolean; message?: string }>(res);
    console.info('[auth.login] response', { status: res.status, body: json });
    if (res.ok && json?.requiresVerification) {
      return { success: true, error: json.message };
    }
    if (!res.ok || !json?.success) {
      const msg = messageForAuthFailure(res, json, 'Login failed');
      useAuth.getState().setError(msg);
      return { success: false, error: msg };
    }
    if (!json.user || !json.token) {
      const msg = 'Login failed';
      useAuth.getState().setError(msg);
      return { success: false, error: msg };
    }
    useAuth.getState().setAuth(json.user, json.token);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    useAuth.getState().setError(msg);
    return { success: false, error: msg };
  } finally {
    useAuth.getState().setLoading(false);
  }
}

export async function apiLoginVerify(email: string, code: string): Promise<{ success: boolean; error?: string }> {
  useAuth.getState().setLoading(true);
  useAuth.getState().setError(null);
  try {
    console.info('[auth.login.verify] request', { email: email.trim().toLowerCase() });
    const res = await fetch('/api/auth/login/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, code }),
    });
    const json = await readJsonSafe<ApiErrorLike & { user?: AuthUser; token?: string }>(res);
    console.info('[auth.login.verify] response', { status: res.status, body: json });
    if (!res.ok || !json?.success) {
      const msg = messageForAuthFailure(res, json, 'Verification failed');
      useAuth.getState().setError(msg);
      return { success: false, error: msg };
    }
    if (!json.user || !json.token) {
      const msg = 'Verification failed';
      useAuth.getState().setError(msg);
      return { success: false, error: msg };
    }
    useAuth.getState().setAuth(json.user, json.token);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    useAuth.getState().setError(msg);
    return { success: false, error: msg };
  } finally {
    useAuth.getState().setLoading(false);
  }
}

export async function apiRegister(email: string, password: string): Promise<{ success: boolean; error?: string }> {
  useAuth.getState().setLoading(true);
  useAuth.getState().setError(null);
  try {
    console.info('[auth.register] request', {
      email: email.trim().toLowerCase(),
      passwordLength: password.length,
    });
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const json = await readJsonSafe<ApiErrorLike & { user?: AuthUser; token?: string; requiresVerification?: boolean; message?: string }>(res);
    console.info('[auth.register] response', { status: res.status, body: json });
    if (res.ok && json?.requiresVerification) {
      return { success: true, error: json.message };
    }
    if (!res.ok || !json?.success) {
      const msg = messageForAuthFailure(res, json, 'Registration failed');
      useAuth.getState().setError(msg);
      return { success: false, error: msg };
    }
    if (!json.user || !json.token) {
      const msg = 'Registration failed';
      useAuth.getState().setError(msg);
      return { success: false, error: msg };
    }
    useAuth.getState().setAuth(json.user, json.token);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    useAuth.getState().setError(msg);
    return { success: false, error: msg };
  } finally {
    useAuth.getState().setLoading(false);
  }
}

export async function apiRegisterVerify(email: string, code: string): Promise<{ success: boolean; error?: string }> {
  useAuth.getState().setLoading(true);
  useAuth.getState().setError(null);
  try {
    console.info('[auth.register.verify] request', { email: email.trim().toLowerCase() });
    const res = await fetch('/api/auth/register/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, code }),
    });
    const json = await readJsonSafe<ApiErrorLike & { user?: AuthUser; token?: string }>(res);
    console.info('[auth.register.verify] response', { status: res.status, body: json });
    if (!res.ok || !json?.success) {
      const msg = messageForAuthFailure(res, json, 'Verification failed');
      useAuth.getState().setError(msg);
      return { success: false, error: msg };
    }
    if (!json.user || !json.token) {
      const msg = 'Verification failed';
      useAuth.getState().setError(msg);
      return { success: false, error: msg };
    }
    useAuth.getState().setAuth(json.user, json.token);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    useAuth.getState().setError(msg);
    return { success: false, error: msg };
  } finally {
    useAuth.getState().setLoading(false);
  }
}

export async function apiRefreshToken(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    const json = await res.json();
    if (json.success && json.token && json.user) {
      useAuth.getState().setAuth(json.user, json.token);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function apiValidateToken(): Promise<boolean> {
  const token = useAuth.getState().token;
  if (!token) {
    // Try refresh if no access token
    return apiRefreshToken();
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include',
    });
    if (res.status === 401) {
      // Access token expired — try refresh
      const refreshed = await apiRefreshToken();
      if (!refreshed) {
        useAuth.getState().clearAuth();
        return false;
      }
      return true;
    }
    const json = await res.json();
    if (json.success && json.user) {
      useAuth.getState().setAuth(json.user, token);
      return true;
    }
    useAuth.getState().clearAuth();
    return false;
  } catch {
    return false;
  }
}

export async function apiLogout(): Promise<void> {
  const token = useAuth.getState().token;
  fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  }).catch(() => { /* ignore */ });
  useAuth.getState().clearAuth();
}
