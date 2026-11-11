type EncryptedBackup = {
  format: 'WallyPadEncryptedBackup' | 'RoomSplitEncryptedBackup';
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt).buffer, iterations: 100_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBackupJson(plaintext: string, password: string): Promise<string> {
  if (!password) throw new Error('Enter a password to encrypt the backup.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const backup: EncryptedBackup = {
    format: 'WallyPadEncryptedBackup',
    version: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(backup, null, 2);
}

export async function decryptBackupJson(encryptedText: string, password: string): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encryptedText);
  } catch {
    throw new Error('Encrypted backup is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Encrypted backup format or password is invalid.');
  }
  const record = parsed as Record<string, unknown>;
  if (
    (record.format !== 'WallyPadEncryptedBackup' &&
      record.format !== 'RoomSplitEncryptedBackup') || record.version !== 1 ||
    typeof record.salt !== 'string' || typeof record.iv !== 'string' ||
    typeof record.ciphertext !== 'string' || !password
  ) throw new Error('Encrypted backup format or password is invalid.');
  const backup: EncryptedBackup = {
    format: record.format,
    version: 1,
    salt: record.salt,
    iv: record.iv,
    ciphertext: record.ciphertext,
  };
  try {
    const key = await deriveKey(password, fromBase64(backup.salt));
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(fromBase64(backup.iv)).buffer },
      key,
      new Uint8Array(fromBase64(backup.ciphertext)).buffer,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('Could not decrypt backup. Check the password and file.');
  }
}
