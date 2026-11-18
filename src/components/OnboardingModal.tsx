import { useState } from 'react';
import type { FormEvent } from 'react';

const AVATARS = ['👨‍💻', '🦁', '⚡', '☕', '🚀'];
const MAX_NICKNAME_LENGTH = 80;

type Props = {
  householdName: string;
  initialName: string;
  initialAvatar: string;
  isSaving: boolean;
  error: string;
  onJoin: (nickname: string, avatar: string) => Promise<void>;
  onCancel: () => void;
};

export default function OnboardingModal({
  householdName,
  initialName,
  initialAvatar,
  isSaving,
  error,
  onJoin,
  onCancel,
}: Props) {
  const [nickname, setNickname] = useState(initialName);
  const [avatar, setAvatar] = useState(
    AVATARS.includes(initialAvatar) ? initialAvatar : AVATARS[0],
  );
  const [validationError, setValidationError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed) {
      setValidationError('Please enter a nickname to join.');
      return;
    }
    if (trimmed.length > MAX_NICKNAME_LENGTH) {
      setValidationError(`Nickname must be ${MAX_NICKNAME_LENGTH} characters or fewer.`);
      return;
    }
    setValidationError('');
    await onJoin(trimmed, avatar);
  };

  return (
    <div className="spaces-modal-backdrop">
      <section
        className="spaces-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="row-between">
          <h2 id="onboarding-title">Welcome to the flat!</h2>
          <span className="avatar-circle" aria-hidden="true">{avatar}</span>
        </div>
        <p id="onboarding-description" className="tx-sub">
          You’re joining <strong>{householdName}</strong>. What should your housemates call you?
        </p>
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div className="form-group">
            <label htmlFor="onboarding-nickname">Your nickname</label>
            <input
              id="onboarding-nickname"
              type="text"
              autoComplete="nickname"
              maxLength={MAX_NICKNAME_LENGTH}
              autoFocus
              value={nickname}
              onChange={(event) => {
                setNickname(event.target.value);
                setValidationError('');
              }}
              placeholder="e.g., Kavindu"
            />
          </div>
          <fieldset className="form-group">
            <legend>Choose your avatar</legend>
            <div className="export-actions">
              {AVATARS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`participant-chip ${avatar === option ? 'selected' : ''}`}
                  aria-label={`Choose ${option} avatar`}
                  aria-pressed={avatar === option}
                  onClick={() => setAvatar(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </fieldset>
          {(validationError || error) && (
            <p className="amount-neg" role="alert">{validationError || error}</p>
          )}
          <div className="export-actions">
            <button type="submit" className="primary" disabled={isSaving}>
              {isSaving ? 'Joining…' : 'Join Shared Flat'}
            </button>
            <button type="button" className="ghost" disabled={isSaving} onClick={onCancel}>Not now</button>
          </div>
        </form>
      </section>
    </div>
  );
}
