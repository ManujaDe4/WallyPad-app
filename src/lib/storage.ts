import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { Household, LocalIdentity, Space, SpaceAccent } from '../types';

interface WallyPadDatabase extends DBSchema {
  appState: {
    key: string;
    value: Household;
  };
  spaces: {
    key: string;
    value: Space;
  };
  settings: {
    key: string;
    value: string;
  };
}

const LEGACY_DATABASE_NAME = 'roomsplit-db';
const LEGACY_MIGRATION_KEY = '__legacyDatabaseMigrated';

const database = openDB<WallyPadDatabase>('wallypad-db', 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('appState')) {
      db.createObjectStore('appState');
    }
    if (!db.objectStoreNames.contains('spaces')) db.createObjectStore('spaces');
    if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
  },
});

const databaseWithLegacyMigration = database.then(async (db) => {
  await migrateLegacyDatabase(db);
  return db;
});

async function hasLegacyDatabase(): Promise<boolean> {
  if (typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases();
    return databases.some((entry) => entry.name === LEGACY_DATABASE_NAME);
  }
  return new Promise((resolve, reject) => {
    let missing = false;
    const request = indexedDB.open(LEGACY_DATABASE_NAME);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) {
        missing = true;
        request.transaction?.abort();
      }
    };
    request.onsuccess = () => {
      request.result.close();
      resolve(true);
    };
    request.onerror = () => {
      if (missing && request.error?.name === 'AbortError') {
        resolve(false);
        return;
      }
      reject(request.error ?? new Error('Could not inspect legacy local storage.'));
    };
  });
}

async function migrateLegacyDatabase(
  targetDb: IDBPDatabase<WallyPadDatabase>,
): Promise<void> {
  if (await targetDb.get('settings', LEGACY_MIGRATION_KEY) === 'true') return;
  if (!await hasLegacyDatabase()) {
    await targetDb.put('settings', 'true', LEGACY_MIGRATION_KEY);
    return;
  }

  const legacyDb = await openDB<WallyPadDatabase>(LEGACY_DATABASE_NAME);
  try {
    for (const storeName of ['appState', 'spaces', 'settings'] as const) {
      const sourceTransaction = legacyDb.transaction(storeName, 'readonly');
      const keys = await sourceTransaction.store.getAllKeys();
      const values = await sourceTransaction.store.getAll();
      await sourceTransaction.done;

      const targetTransaction = targetDb.transaction(storeName, 'readwrite');
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (await targetTransaction.store.get(key) === undefined) {
          await targetTransaction.store.put(values[index], key);
        }
      }
      await targetTransaction.done;
    }
    await targetDb.put('settings', 'true', LEGACY_MIGRATION_KEY);
  } finally {
    legacyDb.close();
  }
}

export async function loadHousehold(): Promise<Household | null> {
  const db = await databaseWithLegacyMigration;
  const activeId = await db.get('settings', 'activeSpaceId');
  if (activeId) {
    const activeSpace = await db.get('spaces', activeId);
    if (activeSpace) return activeSpace.household;
  }
  return (await db.get('appState', 'current')) ?? null;
}

export async function saveHousehold(household: Household): Promise<void> {
  const db = await databaseWithLegacyMigration;
  const transaction = db.transaction(['appState', 'spaces', 'settings'], 'readwrite');
  await transaction.objectStore('appState').put(household, 'current');
  const activeId = await transaction.objectStore('settings').get('activeSpaceId');
  if (activeId) {
    const activeSpace = await transaction.objectStore('spaces').get(activeId);
    if (activeSpace) {
      await transaction.objectStore('spaces').put(
        { ...activeSpace, name: household.name, household },
        activeId,
      );
    }
  }
  await transaction.done;
}

export async function loadSpacesIndex(): Promise<Space[]> {
  const db = await databaseWithLegacyMigration;
  const spaces = await db.getAll('spaces');
  if (spaces.length) {
    const activeId = await db.get('settings', 'activeSpaceId');
    const activeSpace = activeId
      ? spaces.find((space) => space.id === activeId)
      : undefined;
    if (!activeSpace) {
      const selected = spaces[0];
      await db.put('settings', selected.id, 'activeSpaceId');
      await db.put('appState', selected.household, 'current');
    }
    return spaces;
  }
  const legacy = await db.get('appState', 'current');
  if (!legacy) return [];
  const migrated: Space = {
    id: crypto.randomUUID(),
    name: legacy.name,
    accent: legacy.themeAccent ?? 'cyan',
    household: legacy,
  };
  await db.put('spaces', migrated, migrated.id);
  await db.put('settings', migrated.id, 'activeSpaceId');
  return [migrated];
}

export async function loadActiveSpaceId(): Promise<string | null> {
  const db = await databaseWithLegacyMigration;
  return (await db.get('settings', 'activeSpaceId')) ?? null;
}

export async function loadLocalIdentity(): Promise<LocalIdentity | null> {
  const db = await databaseWithLegacyMigration;
  const stored = await db.get('settings', 'localIdentity');
  if (!stored) return null;
  let value: unknown;
  try {
    value = JSON.parse(stored) as unknown;
  } catch {
    throw new Error('Saved local identity data is invalid.');
  }
  if (
    typeof value !== 'object' || value === null ||
    !('name' in value) || typeof value.name !== 'string' ||
    !('avatar' in value) || typeof value.avatar !== 'string'
  ) {
    throw new Error('Saved local identity data is invalid.');
  }
  return { name: value.name, avatar: value.avatar };
}

export async function saveLocalIdentity(identity: LocalIdentity): Promise<void> {
  const db = await databaseWithLegacyMigration;
  await db.put('settings', JSON.stringify(identity), 'localIdentity');
}

export async function saveSpace(
  space: Pick<Space, 'id' | 'name' | 'accent'> & { household?: Household },
): Promise<Space> {
  const db = await databaseWithLegacyMigration;
  const previous = await db.get('spaces', space.id);
  const household = space.household ?? previous?.household ?? {
    id: space.id,
    name: space.name,
    currency: 'LKR' as const,
    members: [],
    expenses: [],
    repayments: [],
    updatedAt: new Date().toISOString().slice(0, 10),
  };
  const saved: Space = {
    id: space.id,
    name: space.name,
    accent: space.accent,
    household: { ...household, name: space.name, themeAccent: space.accent },
  };
  await db.put('spaces', saved, saved.id);
  const activeId = await db.get('settings', 'activeSpaceId');
  if (!activeId || activeId === saved.id) {
    await db.put('settings', saved.id, 'activeSpaceId');
    await db.put('appState', saved.household, 'current');
  }
  return saved;
}

export async function deleteSpace(spaceId: string): Promise<void> {
  const db = await databaseWithLegacyMigration;
  const transaction = db.transaction(['spaces', 'settings', 'appState'], 'readwrite');
  await transaction.objectStore('spaces').delete(spaceId);
  const activeId = await transaction.objectStore('settings').get('activeSpaceId');
  if (activeId === spaceId) {
    const remaining = await transaction.objectStore('spaces').getAll();
    const next = remaining[0];
    if (next) {
      await transaction.objectStore('settings').put(next.id, 'activeSpaceId');
      await transaction.objectStore('appState').put(next.household, 'current');
    } else {
      await transaction.objectStore('settings').delete('activeSpaceId');
      await transaction.objectStore('appState').delete('current');
    }
  }
  await transaction.done;
}

export async function setActiveSpaceId(spaceId: string): Promise<void> {
  const db = await databaseWithLegacyMigration;
  const space = await db.get('spaces', spaceId);
  if (!space) throw new Error('The selected Space could not be found.');
  const transaction = db.transaction(['settings', 'appState'], 'readwrite');
  await transaction.objectStore('settings').put(spaceId, 'activeSpaceId');
  await transaction.objectStore('appState').put(space.household, 'current');
  await transaction.done;
}

export async function updateSpaceAccent(spaceId: string, accent: SpaceAccent): Promise<void> {
  const db = await databaseWithLegacyMigration;
  const space = await db.get('spaces', spaceId);
  if (!space) throw new Error('The selected Space could not be found.');
  await db.put('spaces', {
    ...space,
    accent,
    household: { ...space.household, themeAccent: accent },
  }, spaceId);
  if (await db.get('settings', 'activeSpaceId') === spaceId) {
    await db.put('appState', { ...space.household, themeAccent: accent }, 'current');
  }
}
