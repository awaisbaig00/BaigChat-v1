import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../api';
import type { User } from '../types';
import {
  MessageSquare,
  ArrowRight,
  ShieldCheck,
  Mail,
  Lock,
  User as UserIcon,
  Check,
  X,
  Eye,
  EyeOff,
  KeyRound,
  RotateCcw,
} from 'lucide-react';

interface AuthModalProps {
  onSuccess: (user: User) => void;
  inviteEmail?: string | null;
  initialResetToken?: string | null;
  onOpenLegal?: (type: 'privacy' | 'terms') => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onSuccess, inviteEmail, initialResetToken, onOpenLegal }) => {
  const [view, setView] = useState<'signin' | 'signup' | 'forgot' | 'reset'>(
    initialResetToken ? 'reset' : inviteEmail ? 'signup' : 'signin'
  );

  // Form states
  const [identifier, setIdentifier] = useState(''); // email or username for signin
  const [signupEmail, setSignupEmail] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetToken, setResetToken] = useState(initialResetToken || '');
  const [agreeTerms, setAgreeTerms] = useState(false);

  // Username validation state
  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available?: boolean;
    reason?: string;
  } | null>(null);

  // Status / Feedback
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Debounced username availability check
  const usernameCheckTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (view !== 'signup' || !signupUsername.trim()) {
      setUsernameStatus(null);
      return;
    }

    if (usernameCheckTimeout.current) {
      clearTimeout(usernameCheckTimeout.current);
    }

    const trimmed = signupUsername.trim();
    if (trimmed.length < 3) {
      setUsernameStatus({ checking: false, available: false, reason: 'At least 3 characters' });
      return;
    }

    setUsernameStatus({ checking: true });
    usernameCheckTimeout.current = setTimeout(async () => {
      try {
        const res = await apiRequest<{ available: boolean; reason?: string }>(
          `/api/auth/username-available?u=${encodeURIComponent(trimmed)}`
        );
        setUsernameStatus({ checking: false, available: res.available, reason: res.reason });
      } catch (err: any) {
        setUsernameStatus({ checking: false, available: false, reason: 'Check failed' });
      }
    }, 350);

    return () => {
      if (usernameCheckTimeout.current) clearTimeout(usernameCheckTimeout.current);
    };
  }, [signupUsername, view]);

  // Password strength calculation
  const getPasswordStrength = (pass: string): { score: number; label: string; color: string } => {
    if (!pass) return { score: 0, label: '', color: '' };
    let score = 0;
    if (pass.length >= 10) score += 1;
    if (pass.length >= 14) score += 1;
    if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^a-zA-Z0-9]/.test(pass)) score += 1;

    if (score <= 2) return { score: 1, label: 'Weak (min 10 chars)', color: 'bg-rose-500' };
    if (score <= 4) return { score: 2, label: 'Medium', color: 'bg-amber-500' };
    return { score: 3, label: 'Strong', color: 'bg-emerald-500' };
  };

  const strength = getPasswordStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      if (view === 'signup') {
        if (!agreeTerms) {
          setError('You must accept the Terms of Service and Privacy Policy');
          setLoading(false);
          return;
        }
        const res = await apiRequest<{ user: User; csrfToken: string }>('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email: signupEmail,
            username: signupUsername.trim() || undefined,
            password,
            termsAccepted: true,
          }),
        });
        onSuccess(res.user);
      } else if (view === 'signin') {
        const res = await apiRequest<{ user: User; csrfToken: string }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            identifier: identifier.trim(),
            password,
          }),
        });
        onSuccess(res.user);
      } else if (view === 'forgot') {
        const res = await apiRequest<{ success: boolean; message: string }>('/api/auth/forgot', {
          method: 'POST',
          body: JSON.stringify({ email: identifier.trim() }),
        });
        setSuccessMsg(res.message);
      } else if (view === 'reset') {
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }
        const res = await apiRequest<{ success: boolean; message: string }>('/api/auth/reset', {
          method: 'POST',
          body: JSON.stringify({ token: resetToken.trim(), newPassword: password }),
        });
        setSuccessMsg(res.message);
        setView('signin');
        setPassword('');
        setConfirmPassword('');
      }
    } catch (err: any) {
      setError(err?.message || 'Action failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-2xl p-7 shadow-2xl transition-all duration-300">
        {/* Brand header */}
        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-terracotta)] mb-2.5">
            <MessageSquare className="w-6 h-6" />
          </div>
          <h1 className="font-serif-claude text-2xl font-medium text-[var(--text-primary)] tracking-tight">
            BaigChat
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Fast, private real-time messaging
          </p>
        </div>

        {/* Invite notice */}
        {inviteEmail && view === 'signup' && (
          <div className="mb-4 p-3 bg-[var(--accent-soft)] border border-[var(--accent-terracotta)]/30 rounded-xl text-xs text-[var(--text-primary)] flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[var(--accent-terracotta)] shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-[var(--accent-terracotta)]">{inviteEmail}</span> invited you to chat. Sign in or create an account to accept.
            </div>
          </div>
        )}

        {/* Tab switch for Sign In / Create Account */}
        {(view === 'signin' || view === 'signup') && (
          <div className="grid grid-cols-2 p-1 bg-[var(--bg-base)] rounded-xl border border-[var(--border-subtle)] mb-5 text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setView('signin');
                setError(null);
                setSuccessMsg(null);
              }}
              className={`py-2 rounded-lg transition-all cursor-pointer ${
                view === 'signin'
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setView('signup');
                setError(null);
                setSuccessMsg(null);
              }}
              className={`py-2 rounded-lg transition-all cursor-pointer ${
                view === 'signup'
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        {/* Header for Forgot / Reset view */}
        {view === 'forgot' && (
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <KeyRound className="w-4 h-4 text-[var(--accent-terracotta)]" />
              Reset Your Password
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Enter your account email and we'll generate password reset instructions.
            </p>
          </div>
        )}

        {view === 'reset' && (
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4 text-[var(--accent-terracotta)]" />
              Set New Password
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Choose a secure password with at least 10 characters.
            </p>
          </div>
        )}

        {/* Alerts */}
        {error && (
          <div className="mb-4 p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Sign In identifier */}
          {view === 'signin' && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Email or Username
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@domain.com or @username"
                  className="w-full pl-10 pr-4 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
                />
              </div>
            </div>
          )}

          {/* Signup Email & Username */}
          {view === 'signup' && (
            <>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    placeholder="you@domain.com"
                    className="w-full pl-10 pr-4 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">
                    Username
                  </label>
                  {usernameStatus && !usernameStatus.checking && (
                    <span
                      className={`text-[11px] flex items-center gap-1 ${
                        usernameStatus.available ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {usernameStatus.available ? (
                        <>
                          <Check className="w-3 h-3" /> Available
                        </>
                      ) : (
                        <>
                          <X className="w-3 h-3" /> {usernameStatus.reason || 'Unavailable'}
                        </>
                      )}
                    </span>
                  )}
                  {usernameStatus?.checking && (
                    <span className="text-[11px] text-[var(--text-muted)]">Checking...</span>
                  )}
                </div>
                <div className="relative">
                  <span className="text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono">
                    @
                  </span>
                  <input
                    type="text"
                    value={signupUsername}
                    onChange={(e) => setSignupUsername(e.target.value)}
                    placeholder="your_handle"
                    maxLength={30}
                    className="w-full pl-8 pr-8 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none font-mono"
                  />
                  {usernameStatus && !usernameStatus.checking && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {usernameStatus.available ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <X className="w-4 h-4 text-rose-400" />
                      )}
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  3-30 chars &bull; letters, numbers, dots, underscores
                </p>
              </div>
            </>
          )}

          {/* Forgot Password Email */}
          {view === 'forgot' && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Account Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@domain.com"
                  className="w-full pl-10 pr-4 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
                />
              </div>
            </div>
          )}

          {/* Reset Token field (if resetting) */}
          {view === 'reset' && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Reset Token
              </label>
              <input
                type="text"
                required
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                placeholder="Paste token from reset link"
                className="w-full px-3.5 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none font-mono"
              />
            </div>
          )}

          {/* Password field (for Signin, Signup, Reset) */}
          {view !== 'forgot' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  {view === 'reset' ? 'New Password' : 'Password'}
                </label>
                {view === 'signin' && (
                  <button
                    type="button"
                    onClick={() => {
                      setView('forgot');
                      setError(null);
                      setSuccessMsg(null);
                    }}
                    className="text-[11px] text-[var(--accent-terracotta)] hover:underline cursor-pointer"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={view === 'signup' || view === 'reset' ? 'At least 10 characters' : 'Enter password'}
                  minLength={view === 'signup' || view === 'reset' ? 10 : 1}
                  className="w-full pl-10 pr-10 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Password strength meter on signup and reset */}
              {(view === 'signup' || view === 'reset') && password && (
                <div className="mt-2">
                  <div className="flex gap-1.5 h-1 w-full bg-[var(--bg-base)] rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        strength.score >= 1 ? strength.color : 'bg-transparent'
                      }`}
                      style={{ width: '33.3%' }}
                    />
                    <div
                      className={`h-full transition-all ${
                        strength.score >= 2 ? strength.color : 'bg-transparent'
                      }`}
                      style={{ width: '33.3%' }}
                    />
                    <div
                      className={`h-full transition-all ${
                        strength.score >= 3 ? strength.color : 'bg-transparent'
                      }`}
                      style={{ width: '33.3%' }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-[var(--text-muted)] mt-1">
                    <span>Strength: {strength.label}</span>
                    <span>10-128 chars</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Confirm Password for Reset view */}
          {view === 'reset' && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full pl-10 pr-4 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-terracotta)] rounded-xl text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
                />
              </div>
            </div>
          )}

          {/* Terms and Privacy Policy acceptance on signup */}
          {view === 'signup' && (
            <div className="flex items-start gap-2 pt-1 text-[11px] text-[var(--text-muted)]">
              <input
                type="checkbox"
                id="agree-terms"
                required
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                className="mt-0.5 w-3.5 h-3.5 accent-[var(--accent-terracotta)] cursor-pointer"
              />
              <label htmlFor="agree-terms" className="leading-tight">
                I agree to the{' '}
                <button
                  type="button"
                  onClick={() => onOpenLegal?.('terms')}
                  className="text-[var(--accent-terracotta)] hover:underline font-medium cursor-pointer"
                >
                  Terms of Service
                </button>{' '}
                and{' '}
                <button
                  type="button"
                  onClick={() => onOpenLegal?.('privacy')}
                  className="text-[var(--accent-terracotta)] hover:underline font-medium cursor-pointer"
                >
                  Privacy Policy
                </button>
                . Data is encrypted in transit.
              </label>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading || (view === 'signup' && (!agreeTerms || (usernameStatus ? !usernameStatus.available : false)))}
            className="w-full mt-2 py-2.5 px-4 bg-[var(--accent-terracotta)] hover:bg-[var(--accent-hover)] active:scale-[0.99] text-white font-medium rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-[var(--accent-terracotta)]/20 transition-all disabled:opacity-50 cursor-pointer"
          >
            <span>
              {loading
                ? 'Please wait...'
                : view === 'signup'
                ? 'Create Account'
                : view === 'forgot'
                ? 'Send Reset Link'
                : view === 'reset'
                ? 'Update Password'
                : 'Sign In'}
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          {/* Back to signin button when in forgot/reset view */}
          {(view === 'forgot' || view === 'reset') && (
            <button
              type="button"
              onClick={() => {
                setView('signin');
                setError(null);
                setSuccessMsg(null);
              }}
              className="w-full py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              Back to Sign In
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
