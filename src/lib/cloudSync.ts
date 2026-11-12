import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Household } from '../types';

let client: SupabaseClient | null = null;

function getSupabaseUrl(): string {
  return import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
}

function getSupabaseKey(): string {
  return (
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
    ''
  );
}

export function isCloudConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseKey());
}

export function getSupabaseClient(): SupabaseClient {
  if (!isCloudConfigured()) {
    throw new Error(
      'Cloud sync is not configured. Set VITE_SUPABASE_URL and either ' +
      'VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY, then rebuild the app.',
    );
  }
  if (!client) {
    const url = getSupabaseUrl();
    const apiKey = getSupabaseKey();
    client = createClient(url, apiKey, {
      global: {
        headers: { apikey: apiKey },
      },
    });
  }
  return client;
}

function throwSupabaseError(error: { message: string; code?: string }): never {
  if (/no api key found in request/i.test(error.message)) {
    throw new Error(
      'Supabase did not receive an API key. Check that the VITE_SUPABASE_URL ' +
      'and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY) build ' +
      'variables are set for this deployment, then rebuild and reload the app.',
    );
  }
  throw new Error(
    error.code ? `${error.message} (Supabase ${error.code})` : error.message,
  );
}

function throwRpcError(error: { message: string; code?: string }): never {
  throwSupabaseError(error);
}

export async function hashPin(roomCode: string, pin: string): Promise<string> {
  const input = `${roomCode.toUpperCase().trim()}:${pin.trim()}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function generateRoomCode(householdName: string): string {
  const prefix = householdName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4)
    .padEnd(4, 'X');
  const suffix = Math.floor(Math.random() * 9_000 + 1_000).toString();
  return `${prefix}-${suffix}`;
}

function mergeById<T extends { id: string }>(
  localItems: T[],
  remoteItems: T[],
  deleted: Set<string>,
): T[] {
  const items = new Map<string, T>();
  for (const item of remoteItems) items.set(item.id, item);
  for (const item of localItems) items.set(item.id, item);
  return [...items.values()].filter((item) => !deleted.has(item.id));
}

function mergeNeedsById(
  localItems: NonNullable<Household['needsLedger']>,
  remoteItems: NonNullable<Household['needsLedger']>,
  deleted: Set<string>,
): NonNullable<Household['needsLedger']> {
  const items = new Map<string, NonNullable<Household['needsLedger']>[number]>();
  for (const item of remoteItems) items.set(item.id, item);
  for (const item of localItems) {
    const remoteItem = items.get(item.id);
    if (
      !remoteItem ||
      !remoteItem.updatedAt ||
      (item.updatedAt && item.updatedAt >= remoteItem.updatedAt)
    ) {
      items.set(item.id, item);
    }
  }
  return [...items.values()].filter((item) => !deleted.has(item.id));
}

export function mergeHouseholds(
  local: Household,
  remote: Household,
  remoteDeletedIds: string[],
): Household {
  const deletedIds = [...new Set([
    ...(local.deletedIds ?? []),
    ...(remote.deletedIds ?? []),
    ...remoteDeletedIds,
  ])];
  const deleted = new Set(deletedIds);

  return {
    ...remote,
    ...local,
    members: mergeById(local.members, remote.members, deleted),
    expenses: mergeById(local.expenses, remote.expenses, deleted),
    repayments: mergeById(local.repayments, remote.repayments, deleted),
    needsLedger: mergeNeedsById(
      local.needsLedger ?? [],
      remote.needsLedger ?? [],
      deleted,
    ),
    deletedIds,
    updatedAt: local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt,
    syncRoomCode: local.syncRoomCode ?? remote.syncRoomCode,
    syncPinHash: local.syncPinHash ?? remote.syncPinHash,
  };
}

function assertHousehold(value: unknown): Household {
  if (
    typeof value !== 'object' || value === null ||
    !('id' in value) || typeof value.id !== 'string' ||
    !('name' in value) || typeof value.name !== 'string' ||
    !('currency' in value) || value.currency !== 'LKR' ||
    !('members' in value) || !Array.isArray(value.members) ||
    !('expenses' in value) || !Array.isArray(value.expenses) ||
    !('repayments' in value) || !Array.isArray(value.repayments) ||
    !('updatedAt' in value) || typeof value.updatedAt !== 'string'
  ) {
    throw new Error('The room returned invalid household data.');
  }
  const memberRecordsValid = value.members.every((member) =>
    typeof member === 'object' && member !== null &&
    'id' in member && typeof member.id === 'string' &&
    'name' in member && typeof member.name === 'string',
  );
  const expenseRecordsValid = value.expenses.every((expense) =>
    typeof expense === 'object' && expense !== null &&
    'id' in expense && typeof expense.id === 'string' &&
    'title' in expense && typeof expense.title === 'string' &&
    'amountCents' in expense && typeof expense.amountCents === 'number' &&
    'shares' in expense && Array.isArray(expense.shares),
  );
  const repaymentRecordsValid = value.repayments.every((repayment) =>
    typeof repayment === 'object' && repayment !== null &&
    'id' in repayment && typeof repayment.id === 'string' &&
    'fromId' in repayment && typeof repayment.fromId === 'string' &&
    'toId' in repayment && typeof repayment.toId === 'string' &&
    'amountCents' in repayment && typeof repayment.amountCents === 'number',
  );
  const needsLedgerValid = !('needsLedger' in value) ||
    (Array.isArray(value.needsLedger) && value.needsLedger.every((item) =>
      typeof item === 'object' && item !== null &&
      'id' in item && typeof item.id === 'string' &&
      'name' in item && typeof item.name === 'string' &&
      'isChecked' in item && typeof item.isChecked === 'boolean' &&
      'lastPriceCents' in item && typeof item.lastPriceCents === 'number' &&
      Number.isSafeInteger(item.lastPriceCents) && item.lastPriceCents >= 0 &&
      (!('updatedAt' in item) || typeof item.updatedAt === 'string') &&
      (!('lastPurchasedAt' in item) || typeof item.lastPurchasedAt === 'string')
    ));
  const tombstonesValid = !('deletedIds' in value) ||
    (Array.isArray(value.deletedIds) &&
      value.deletedIds.every((id) => typeof id === 'string'));
  if (
    !memberRecordsValid || !expenseRecordsValid || !repaymentRecordsValid ||
    !needsLedgerValid || !tombstonesValid
  ) {
    throw new Error('The room returned invalid household data.');
  }
  return value as Household;
}

function householdFromResponse(data: unknown): Household {
  let value = data;
  if (Array.isArray(value)) value = value[0];
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new Error('The room returned invalid household data.');
    }
  }
  if (typeof value === 'object' && value !== null) {
    for (const key of [
      'household',
      'payload',
      'household_data',
      'room_data',
      'room_payload',
      'household_json',
      'data',
    ]) {
      if (key in value) {
        const nested = (value as Record<string, unknown>)[key];
        if (nested !== null && nested !== undefined) return assertHousehold(nested);
      }
    }
  }
  return assertHousehold(value);
}

async function fetchRoom(roomCode: string, pinHash: string): Promise<Household> {
  const { data, error } = await getSupabaseClient().rpc('fetch_room_with_pin', {
    p_room_code: roomCode,
    p_pin_hash: pinHash,
  });
  if (error) throwRpcError(error);
  return householdFromResponse(data);
}

async function upsertRoom(
  roomCode: string,
  pinHash: string,
  household: Household,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc('upsert_room_with_pin', {
    p_room_code: roomCode,
    p_pin_hash: pinHash,
    p_household: household,
    p_deleted_ids: household.deletedIds ?? [],
  });
  if (error) throwRpcError(error);
}

export async function enableRoomSync(
  household: Household,
  pin: string,
): Promise<Household> {
  if (!/^\d{4}$/.test(pin.trim())) {
    throw new Error('Enter a 4-digit room PIN.');
  }
  const roomCode = generateRoomCode(household.name);
  const syncPinHash = await hashPin(roomCode, pin);
  const syncedHousehold: Household = {
    ...household,
    syncRoomCode: roomCode,
    syncPinHash,
    pendingSync: false,
    lastSyncedAt: new Date().toISOString(),
  };
  await upsertRoom(roomCode, syncPinHash, syncedHousehold);
  return syncedHousehold;
}

export async function joinRoomSync(
  roomCode: string,
  pin: string,
): Promise<Household> {
  const normalizedCode = roomCode.trim().toUpperCase();
  if (!normalizedCode) throw new Error('Enter a room code.');
  if (!/^\d{4}$/.test(pin.trim())) {
    throw new Error('Enter a 4-digit room PIN.');
  }
  const syncPinHash = await hashPin(normalizedCode, pin);
  const household = await fetchRoom(normalizedCode, syncPinHash);
  return {
    ...household,
    syncRoomCode: normalizedCode,
    syncPinHash,
    pendingSync: false,
  };
}

export async function pushOrMergeRoom(household: Household): Promise<Household> {
  if (!household.syncRoomCode || !household.syncPinHash) {
    throw new Error('This household is not connected to a cloud room.');
  }
  if (!isCloudConfigured() || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return { ...household, pendingSync: true };
  }
  try {
    const remote = await fetchRoom(household.syncRoomCode, household.syncPinHash);
    const merged = mergeHouseholds(
      household,
      remote,
      remote.deletedIds ?? [],
    );
    const syncedHousehold: Household = {
      ...merged,
      lastSyncedAt: new Date().toISOString(),
      pendingSync: false,
    };
    await upsertRoom(
      household.syncRoomCode,
      household.syncPinHash,
      syncedHousehold,
    );
    return syncedHousehold;
  } catch (error) {
    console.error('WallyPad cloud sync failed; changes remain pending.', error);
    return { ...household, pendingSync: true };
  }
}

export function subscribeToRoom(
  roomCode: string,
  onRemoteUpdate: (remotePayload: unknown) => void,
): () => void {
  const channel = getSupabaseClient()
    .channel(`wallypad-room-${roomCode}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'wallypad_rooms',
        filter: `room_code=eq.${roomCode}`,
      },
      (payload) => onRemoteUpdate(payload),
    )
    .subscribe();
  return () => {
    void getSupabaseClient().removeChannel(channel);
  };
}
