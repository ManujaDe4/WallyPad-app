export function getLocalMemberId(householdId: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  const key = `wallypad_identity_${householdId}`;
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const legacyKey = `roomsplit_identity_${householdId}`;
  const legacyValue = localStorage.getItem(legacyKey);
  if (legacyValue) {
    localStorage.setItem(key, legacyValue);
    localStorage.removeItem(legacyKey);
  }
  return legacyValue;
}

export function setLocalMemberId(householdId: string, memberId: string): void {
  const key = `wallypad_identity_${householdId}`;
  localStorage.setItem(key, memberId);
  localStorage.removeItem(`roomsplit_identity_${householdId}`);
}
