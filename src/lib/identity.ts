export function getLocalMemberId(householdId: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(`roomsplit_identity_${householdId}`);
}

export function setLocalMemberId(householdId: string, memberId: string): void {
  localStorage.setItem(`roomsplit_identity_${householdId}`, memberId);
}
