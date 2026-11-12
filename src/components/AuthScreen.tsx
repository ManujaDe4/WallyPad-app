import { useState } from 'react';
import type { FormEvent } from 'react';
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
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand" aria-label="WallyPad">
          <span className="auth-brand-mark" aria-hidden="true">W</span>
          <span>WallyPad</span>
        </div>
        <h1 id="auth-title">{isSignUp ? 'Create your account' : 'Welcome back'}</h1>
        <p className="auth-subtitle">
          {isSignUp
            ? 'A better way to keep your household in balance.'
            : 'Sign in to continue to your household.'}
        </p>

        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
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
            />
          </div>
          {(error || startupError) && (
            <p className="auth-error" role="alert">
              {error || startupError}
            </p>
          )}
          {message && (
            <p className="auth-message" role="status">
              {message}
            </p>
          )}
          <button type="submit" className="primary auth-submit" disabled={isSubmitting}>
            {isSubmitting
              ? 'Please wait…'
              : isSignUp
                ? 'Create Account'
                : 'Sign In'}
          </button>
        </form>

        <p className="auth-mode-prompt">
          {isSignUp ? 'Already have an account?' : 'New to WallyPad?'}
          <button
            type="button"
            className="auth-mode-toggle"
            onClick={() => switchMode(!isSignUp)}
          >
            {isSignUp ? 'Sign In' : 'Create Account'}
          </button>
        </p>
      </section>
    </main>
  );
}
