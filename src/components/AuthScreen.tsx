import type { CSSProperties, FormEvent } from 'react';
import { useState } from 'react';
import { getSupabaseClient } from '../lib/cloudSync';

type Props = {
  startupError: string;
  onClearStartupError: () => void;
};

export default function AuthScreen({
  startupError,
  onClearStartupError,
}: Props) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const switchMode = (nextIsSignUp: boolean) => {
    setIsSignUp(nextIsSignUp);
    setError('');
    setMessage('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    onClearStartupError();
    if (isSignUp && !fullName.trim()) {
      setError('Enter your full name.');
      return;
    }
    setIsSubmitting(true);

    try {
      const supabase = getSupabaseClient();
      if (isSignUp) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim() },
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setMessage('Check your email to confirm your account, then sign in.');
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Could not authenticate. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-screen" aria-label="WallyPad sign-in">
      {/* Large two-line hero headline */}
      <div className="auth-hero">
        <h1 className="auth-headline" id="auth-title">
          <span className="auth-line-1">{isSignUp ? 'CREATE' : 'WELCOME'}</span>
          <span className="auth-line-2">{isSignUp ? 'YOUR ACCOUNT.' : 'BACK.'}</span>
        </h1>
        <p className="auth-sub">
          {isSignUp
            ? 'A better way to keep your household in balance.'
            : 'Sign in to continue to your household.'}
        </p>
      </div>

      {/* Mode toggle — segmented pill control */}
      <div
        className="segmented auth-mode-toggle"
        role="group"
        aria-label="Authentication mode"
        style={{ '--n': 2, '--i': isSignUp ? 1 : 0 } as CSSProperties}
      >
        <span className="seg-thumb" aria-hidden="true" />
        <button
          type="button"
          className={`seg-btn ${!isSignUp ? 'active' : ''}`}
          aria-pressed={!isSignUp}
          onClick={() => switchMode(false)}
        >
          Sign In
        </button>
        <button
          type="button"
          className={`seg-btn ${isSignUp ? 'active' : ''}`}
          aria-pressed={isSignUp}
          onClick={() => switchMode(true)}
        >
          Create Account
        </button>
      </div>

      {/* Auth form card */}
      <section className="auth-form-card" aria-labelledby="auth-title">
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          {isSignUp && (
            <div className="form-group">
              <label htmlFor="auth-full-name">Full Name</label>
              <input
                id="auth-full-name"
                type="text"
                autoComplete="name"
                maxLength={80}
                required
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="e.g., Manuja Perera"
              />
            </div>
          )}
          <div className="form-group">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="form-group">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </div>

          {/* Errors & messages styled as color-block cards */}
          {(error || startupError) && (
            <div className="auth-message-card auth-error" role="alert">
              {error || startupError}
            </div>
          )}
          {message && (
            <div className="auth-message-card auth-success" role="status">
              {message}
            </div>
          )}

          {/* Full-width primary button with circular arrow glyph */}
          <button
            type="submit"
            className="auth-submit-btn"
            disabled={isSubmitting}
          >
            <span>
              {isSubmitting
                ? 'Please wait…'
                : isSignUp
                  ? 'Create Account'
                  : 'Sign In'}
            </span>
            {!isSubmitting && (
              <span className="auth-submit-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" width={22} height={22}>
                  <path d="M7 17 17 7M8 7h9v9" />
                </svg>
              </span>
            )}
          </button>
        </form>
      </section>
    </main>
  );
}
