import { openDB } from 'idb';
import type { DBSchema } from 'idb';
import type { Household } from '../types';

interface RoomSplitDatabase extends DBSchema {
  appState: {
    key: string;
    value: Household;
  };
}

const database = openDB<RoomSplitDatabase>('roomsplit-db', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('appState')) {
      db.createObjectStore('appState');
    }
  },
});

export async function loadHousehold(): Promise<Household | null> {
  const db = await database;
  return (await db.get('appState', 'current')) ?? null;
}

export async function saveHousehold(household: Household): Promise<void> {
  const db = await database;
  await db.put('appState', household, 'current');
}
