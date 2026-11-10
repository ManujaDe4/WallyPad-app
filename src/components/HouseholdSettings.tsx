import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { Household } from '../types';
import { exportBackupFile, validateBackupJson } from '../lib/backup';
import { centsToInputString, parseMoney } from '../lib/money';
import { exportCsvReport, exportPdfReport } from '../lib/reports';
import { decryptBackupJson, encryptBackupJson } from '../lib/cryptoBackup';
import { getLocalMemberId } from '../lib/identity';
import {
  enableRoomSync,
  isCloudConfigured,
  joinRoomSync,
} from '../lib/cloudSync';

type Props = {
  household: Household;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  onUpdateHousehold: (next: Household) => Promise<boolean>;
  onLoadDemo: () => Promise<boolean>;
  onResetEmpty: () => Promise<boolean>;
  onJoinHousehold: (household: Household) => Promise<boolean>;
  onSyncNow: () => Promise<boolean>;
  isSaving: boolean;
};

const MAX_NAME_LENGTH = 80;
type ReplacementAction = 'empty' | 'demo';
const BUDGET_CATEGORIES = ['Groceries', 'Rent', 'Utilities', 'Other'];

function getBudgetInputs(household: Household): Record<string, string> {
  return Object.fromEntries(BUDGET_CATEGORIES.map((category) => [
    category,
    household.categoryBudgetsCents?.[category] === undefined
      ? ''
      : centsToInputString(household.categoryBudgetsCents[category]),
  ]));
}

export default function HouseholdSettings({
  household,
  theme,
  setTheme,
  onUpdateHousehold,
  onLoadDemo,
  onResetEmpty,
  onJoinHousehold,
  onSyncNow,
  isSaving,
}: Props) {
  const [householdNameInput, setHouseholdNameInput] = useState(household.name);
  const [lastHouseholdName, setLastHouseholdName] = useState(household.name);
  const [monthlyBudgetInput, setMonthlyBudgetInput] = useState(
    () => household.monthlyBudgetCents === undefined
      ? ''
      : centsToInputString(household.monthlyBudgetCents),
  );
  const [householdError, setHouseholdError] = useState('');
  const [householdSavedMsg, setHouseholdSavedMsg] = useState('');

  const [newMemberName, setNewMemberName] = useState('');
  const [addMemberError, setAddMemberError] = useState('');

  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editError, setEditError] = useState('');
  const [backupError, setBackupError] = useState('');
  const [restorePreview, setRestorePreview] = useState<Household | null>(null);
  const [pendingReplacement, setPendingReplacement] =
    useState<ReplacementAction | null>(null);
  const [backupPassword, setBackupPassword] = useState('');
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>(
    () => getBudgetInputs(household),
  );
  const [roomMode, setRoomMode] = useState<'create' | 'join'>('create');
  const [roomPin, setRoomPin] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [cloudError, setCloudError] = useState('');
  const [cloudMessage, setCloudMessage] = useState('');
  const [cloudBusy, setCloudBusy] = useState(false);
  const cloudConfigured = isCloudConfigured();
  const myMemberId = getLocalMemberId(household.id);
  const isAdmin = household.adminId === undefined || myMemberId === household.adminId;

  if (lastHouseholdName !== household.name) {
    setLastHouseholdName(household.name);
    setHouseholdNameInput(household.name);
  }

  const isMemberReferenced = (memberId: string): boolean => {
    const inExpenses = household.expenses.some(
      (exp) =>
        exp.paidById === memberId ||
        exp.shares.some((share) => share.memberId === memberId),
    );
    const inRepayments = household.repayments.some(
      (rep) => rep.fromId === memberId || rep.toId === memberId,
    );
    return inExpenses || inRepayments;
  };

  const validateMemberName = (
    rawName: string,
    ignoreMemberId?: string,
  ): string | null => {
    const trimmed = rawName.trim();
    if (!trimmed) {
      return 'Member name cannot be empty.';
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      return `Member name must be ${MAX_NAME_LENGTH} characters or fewer.`;
    }
    const duplicate = household.members.some(
      (m) =>
        m.id !== ignoreMemberId &&
        m.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) {
      return `"${trimmed}" is already in this household.`;
    }
    return null;
  };

  const handleHouseholdSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setHouseholdSavedMsg('');
    const trimmed = householdNameInput.trim();

    if (!trimmed) {
      setHouseholdError('Household name is required.');
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setHouseholdError(
        `Household name must be ${MAX_NAME_LENGTH} characters or fewer.`,
      );
      return;
    }
    const rawBudget = monthlyBudgetInput.trim();
    let monthlyBudgetCents: number | undefined;
    if (rawBudget) {
      const parsedBudget = parseMoney(rawBudget, { allowZero: true });
      if (parsedBudget.ok === false) {
        setHouseholdError(`Monthly household budget: ${parsedBudget.error}`);
        return;
      }
      if (parsedBudget.cents > 0) monthlyBudgetCents = parsedBudget.cents;
    }

    setHouseholdError('');
    setHouseholdNameInput(trimmed);
    const nextHousehold: Household = {
      ...household,
      name: trimmed,
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    if (monthlyBudgetCents === undefined) {
      delete nextHousehold.monthlyBudgetCents;
    } else {
      nextHousehold.monthlyBudgetCents = monthlyBudgetCents;
    }
    const saved = await onUpdateHousehold(nextHousehold);
    if (saved) {
      setMonthlyBudgetInput(monthlyBudgetCents === undefined
        ? ''
        : centsToInputString(monthlyBudgetCents));
      setHouseholdSavedMsg('Household profile updated.');
    }
  };

  const handleAddMember = async (e: FormEvent) => {
    e.preventDefault();
    const error = validateMemberName(newMemberName);
    if (error) {
      setAddMemberError(error);
      return;
    }

    const trimmed = newMemberName.trim();
    const saved = await onUpdateHousehold({
      ...household,
      members: [
        ...household.members,
        { id: crypto.randomUUID(), name: trimmed },
      ],
      updatedAt: new Date().toISOString().slice(0, 10),
    });
    if (saved) {
      setAddMemberError('');
      setNewMemberName('');
    }
  };

  const startEditingMember = (id: string, currentName: string) => {
    setEditingMemberId(id);
    setEditingName(currentName);
    setEditError('');
  };

  const handleSaveRename = async (e: FormEvent, memberId: string) => {
    e.preventDefault();
    const error = validateMemberName(editingName, memberId);
    if (error) {
      setEditError(error);
      return;
    }

    const trimmed = editingName.trim();
    const saved = await onUpdateHousehold({
      ...household,
      members: household.members.map((m) =>
        m.id === memberId ? { ...m, name: trimmed } : m,
      ),
      updatedAt: new Date().toISOString().slice(0, 10),
    });
    if (!saved) return;
    setEditingMemberId(null);
    setEditingName('');
    setEditError('');
  };

  const handleDeleteMember = async (memberId: string) => {
    if (isMemberReferenced(memberId)) return;

    await onUpdateHousehold({
      ...household,
      members: household.members.filter((m) => m.id !== memberId),
      deletedIds: [...new Set([...(household.deletedIds ?? []), memberId])],
      updatedAt: new Date().toISOString().slice(0, 10),
    });
  };

  const handleEnableRoomSync = async (event: FormEvent) => {
    event.preventDefault();
    setCloudError('');
    setCloudMessage('');
    if (!/^\d{4}$/.test(roomPin.trim())) {
      setCloudError('Enter a 4-digit room PIN.');
      return;
    }
    setCloudBusy(true);
    try {
      const connected = await enableRoomSync(household, roomPin);
      if (await onUpdateHousehold(connected)) {
        setCloudMessage('Room sync is ready. Share the room code with your housemates.');
      }
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : 'Could not create a cloud room.');
    } finally {
      setCloudBusy(false);
    }
  };

  const handleJoinRoom = async (event: FormEvent) => {
    event.preventDefault();
    setCloudError('');
    setCloudMessage('');
    if (!/^\d{4}$/.test(roomPin.trim())) {
      setCloudError('Enter a 4-digit room PIN.');
      return;
    }
    setCloudBusy(true);
    try {
      const joined = await joinRoomSync(roomCodeInput, roomPin);
      if (await onJoinHousehold(joined)) {
        setCloudMessage('Shared household saved as a new Space.');
      }
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : 'Could not join this room.');
    } finally {
      setCloudBusy(false);
    }
  };

  const handleDisconnectRoom = async () => {
    setCloudError('');
    setCloudMessage('');
    const saved = await onUpdateHousehold({
      ...household,
      syncRoomCode: undefined,
      syncPinHash: undefined,
      pendingSync: false,
      lastSyncedAt: undefined,
    });
    if (saved) setCloudMessage('Cloud sync disconnected on this device.');
  };

  const handleCopyInvite = async () => {
    const inviteUrl = new URL('https://roomsplit-app.pages.dev/');
    inviteUrl.searchParams.set('join', household.syncRoomCode ?? '');
    const hasInvitePin = /^\d{4}$/.test(roomPin.trim());
    if (hasInvitePin) inviteUrl.searchParams.set('pin', roomPin.trim());
    const message = hasInvitePin
      ? `Join ${household.name} on RoomSplit: ${inviteUrl.toString()}`
      : `Join ${household.name} on RoomSplit: ${inviteUrl.toString()}\nAsk me for the 4-digit room PIN.`;
    try {
      await navigator.clipboard.writeText(message);
      setCloudError('');
      setCloudMessage('WhatsApp invite copied to clipboard.');
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : 'Could not copy the invite.');
      setCloudMessage('');
    }
  };

  const handleBackupFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    setBackupError('');
    setRestorePreview(null);
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setBackupError('Backup file must be 3 MB or smaller.');
      return;
    }
    try {
      let rawText = await file.text();
      let envelope: unknown;
      try {
        envelope = JSON.parse(rawText);
      } catch {
        envelope = null;
      }
      if (
        typeof envelope === 'object' && envelope !== null &&
        'format' in envelope && envelope.format === 'RoomSplitEncryptedBackup'
      ) {
        rawText = await decryptBackupJson(rawText, backupPassword);
      }
      const result = validateBackupJson(rawText);
      if (result.ok === false) {
        setBackupError(result.error);
        return;
      }
      setRestorePreview(result.household);
    } catch (error) {
      setBackupError(
        error instanceof Error ? error.message : 'Could not read backup file.',
      );
    }
  };

  const runReplacement = (action: ReplacementAction) => {
    setPendingReplacement(action);
  };

  const confirmReplacement = async () => {
    if (!pendingReplacement) return;
    const saved =
      pendingReplacement === 'empty'
        ? await onResetEmpty()
        : await onLoadDemo();
    if (saved) {
      setPendingReplacement(null);
      setBudgetInputs(getBudgetInputs({
        ...household,
        categoryBudgetsCents: undefined,
      }));
      setMonthlyBudgetInput('');
    }
  };

  const confirmRestore = async () => {
    if (!restorePreview) return;
    const saved = await onUpdateHousehold(restorePreview);
    if (saved) {
      setRestorePreview(null);
      setBackupError('');
      setBudgetInputs(getBudgetInputs(restorePreview));
      setMonthlyBudgetInput(restorePreview.monthlyBudgetCents === undefined
        ? ''
        : centsToInputString(restorePreview.monthlyBudgetCents));
    }
  };

  const saveBudgets = async () => {
    const budgets: Record<string, number> = {};
    for (const category of BUDGET_CATEGORIES) {
      const rawValue = budgetInputs[category]?.trim();
      if (!rawValue) continue;
      const parsed = parseMoney(rawValue, { allowZero: true });
      if (parsed.ok === false) {
        setBackupError(`${category} budget: ${parsed.error}`);
        return;
      }
      if (parsed.cents > 0) budgets[category] = parsed.cents;
    }
    setBackupError('');
    await onUpdateHousehold({
      ...household,
      categoryBudgetsCents: budgets,
      updatedAt: new Date().toISOString().slice(0, 10),
    });
  };

  const exportEncryptedBackup = async () => {
    try {
      const content = await encryptBackupJson(JSON.stringify({
        app: 'RoomSplit',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        household,
      }, null, 2), backupPassword);
      const link = document.createElement('a');
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      link.href = url;
      link.download = `roomsplit-encrypted-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : 'Could not encrypt backup.');
    }
  };

  return (
    <div className="stack">
      <section className="card theme-settings-card">
        <div>
          <h2>App Theme</h2>
          <p className="tx-sub">Choose a comfortable appearance for RoomSplit.</p>
        </div>
        <div className="theme-toggle" role="group" aria-label="App theme">
          <button
            type="button"
            className={theme === 'light' ? 'active' : ''}
            aria-pressed={theme === 'light'}
            onClick={() => setTheme('light')}
          >
            🌞 Light Mode
          </button>
          <button
            type="button"
            className={theme === 'dark' ? 'active' : ''}
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme('dark')}
          >
            🌙 Dark Mode
          </button>
        </div>
      </section>

      <section className="card cloud-sync-card">
        <h2>Live Multi-Device Sync (Room Code)</h2>
        {!cloudConfigured && (
          <p className="tx-sub">
            Cloud sync is unavailable in this installation. Your household remains saved offline.
          </p>
        )}
        {household.syncRoomCode && household.syncPinHash ? (
          <>
            <p className="row-between">
              <span>Room Code</span>
              <strong className="room-code">{household.syncRoomCode}</strong>
            </p>
            <p className="tx-sub">
              {household.pendingSync
                ? 'Changes are waiting to sync.'
                : 'This Space is connected to its shared room.'}
            </p>
            <div className="form-group">
              <label htmlFor="invite-room-pin">PIN to include in invite (optional)</label>
              <input
                id="invite-room-pin"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                value={roomPin}
                onChange={(event) => setRoomPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Enter PIN or ask friends to request it"
              />
            </div>
            <div className="export-actions">
              <button type="button" disabled={!cloudConfigured} onClick={() => void handleCopyInvite()}>
                📋 Copy WhatsApp Invite Link
              </button>
              <button type="button" disabled={!cloudConfigured || cloudBusy} onClick={() => {
                setCloudBusy(true);
                void onSyncNow().then((synced) => {
                  setCloudMessage(synced ? 'Room synced.' : '');
                  setCloudError(synced ? '' : 'Room sync is still pending.');
                }).catch((error: unknown) => {
                  setCloudError(error instanceof Error ? error.message : 'Could not sync this room.');
                }).finally(() => setCloudBusy(false));
              }}>
                🔄 Sync Now
              </button>
              <button type="button" disabled={isSaving || cloudBusy} onClick={() => void handleDisconnectRoom()}>
                Disconnect Cloud Sync
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="export-actions">
              <button
                type="button"
                aria-pressed={roomMode === 'create'}
                onClick={() => setRoomMode('create')}
              >
                Create a Room
              </button>
              <button
                type="button"
                aria-pressed={roomMode === 'join'}
                onClick={() => setRoomMode('join')}
              >
                🔗 Join a Friend's Room
              </button>
            </div>
            {roomMode === 'create' ? (
              <form onSubmit={(event) => void handleEnableRoomSync(event)} noValidate>
                <div className="form-group">
                  <label htmlFor="create-room-pin">Choose a 4-digit room PIN</label>
                  <input
                    id="create-room-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={4}
                    value={roomPin}
                    onChange={(event) => setRoomPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="4 digits"
                  />
                </div>
                <button type="submit" className="primary" disabled={!cloudConfigured || cloudBusy || isSaving}>
                  🚀 Go Live &amp; Generate Room Code
                </button>
              </form>
            ) : (
              <form onSubmit={(event) => void handleJoinRoom(event)} noValidate>
                <div className="form-group">
                  <label htmlFor="join-room-code">Room Code</label>
                  <input
                    id="join-room-code"
                    type="text"
                    autoCapitalize="characters"
                    value={roomCodeInput}
                    onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
                    placeholder="e.g., FLAT-4829"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="join-room-pin">4-digit room PIN</label>
                  <input
                    id="join-room-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={4}
                    value={roomPin}
                    onChange={(event) => setRoomPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="4 digits"
                  />
                </div>
                <button type="submit" className="primary" disabled={!cloudConfigured || cloudBusy}>
                  Join Shared Household
                </button>
              </form>
            )}
          </>
        )}
        {cloudError && <p className="amount-neg" role="alert">{cloudError}</p>}
        {cloudMessage && <p className="amount-pos" role="status">{cloudMessage}</p>}
      </section>

      <section className="card">
        <h2>Household Profile</h2>
        <form onSubmit={handleHouseholdSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="household-name">Household Name</label>
            <input
              id="household-name"
              type="text"
              value={householdNameInput}
              disabled={!isAdmin}
              onChange={(e) => {
                setHouseholdNameInput(e.target.value);
                setHouseholdError('');
                setHouseholdSavedMsg('');
              }}
              placeholder="e.g., Colombo Student Flat"
            />
            {householdError && (
              <small className="amount-neg" role="alert">
                {householdError}
              </small>
            )}
            {householdSavedMsg && (
              <small className="amount-pos" role="status">
                {householdSavedMsg}
              </small>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="monthly-household-budget">
              Monthly Household Budget (Optional)
            </label>
            <input
              id="monthly-household-budget"
              type="text"
              inputMode="decimal"
              value={monthlyBudgetInput}
              disabled={!isAdmin}
              onChange={(event) => {
                setMonthlyBudgetInput(event.target.value);
                setHouseholdError('');
                setHouseholdSavedMsg('');
              }}
              placeholder="e.g., 50000.00"
              aria-describedby="monthly-household-budget-help"
            />
            <small id="monthly-household-budget-help" className="tx-sub">
              Enter an amount in LKR, or leave blank to remove the budget.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="household-currency">Ledger Currency</label>
            <input
              id="household-currency"
              type="text"
              value="LKR — Sri Lankan Rupee"
              disabled
            />
          </div>

          {isAdmin && (
            <button type="submit" className="primary" disabled={isSaving}>
              Save Profile
            </button>
          )}
        </form>
      </section>

      <section className="card">
        <h2>Add Housemate</h2>
        <form onSubmit={handleAddMember} noValidate>
          <div className="form-group">
            <label htmlFor="new-member-name">Member Name</label>
            <input
              id="new-member-name"
              type="text"
              value={newMemberName}
              onChange={(e) => {
                setNewMemberName(e.target.value);
                setAddMemberError('');
              }}
              placeholder="e.g., Manuja, Nimal, Kavindu"
            />
            {addMemberError && (
              <small className="amount-neg" role="alert">
                {addMemberError}
              </small>
            )}
          </div>
          <button type="submit" className="primary" disabled={isSaving}>
            + Add Housemate
          </button>
        </form>
      </section>

      <div className="section-head">
        <h2>Housemates ({household.members.length})</h2>
      </div>

      {household.members.length === 0 ? (
        <div className="empty-state">
          <p>No housemates yet. Add your first housemate above.</p>
        </div>
      ) : (
        <div className="tx-list">
          {household.members.map((member) => {
            const referenced = isMemberReferenced(member.id);
            const isEditing = editingMemberId === member.id;

            return (
              <div key={member.id} className="tx-row">
                {isEditing ? (
                  <form
                    onSubmit={(e) => handleSaveRename(e, member.id)}
                    className="stack"
                    style={{ width: '100%' }}
                    noValidate
                  >
                    <div
                      className="form-group"
                      style={{ marginBottom: 0 }}
                    >
                      <label htmlFor={`rename-${member.id}`}>
                        Rename {member.name}
                      </label>
                      <input
                        id={`rename-${member.id}`}
                        type="text"
                        value={editingName}
                        onChange={(e) => {
                          setEditingName(e.target.value);
                          setEditError('');
                        }}
                      />
                      {editError && (
                        <small className="amount-neg" role="alert">
                          {editError}
                        </small>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button type="submit" className="primary" disabled={isSaving}>
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => {
                          setEditingMemberId(null);
                          setEditError('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="tx-left">
                      <div className="tx-avatar">
                        {member.avatar ?? member.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="tx-info">
                        <p className="tx-title">{member.name}</p>
                        <div className="tx-sub">
                          {referenced
                            ? 'Active in ledger'
                            : 'No linked records'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() =>
                          startEditingMember(member.id, member.name)
                        }
                      >
                        Rename
                      </button>
                      {(isAdmin || myMemberId === member.id) && (
                        <button
                          type="button"
                          disabled={isSaving || referenced}
                          onClick={() => void handleDeleteMember(member.id)}
                          style={{
                            opacity: referenced ? 0.45 : 1,
                            cursor: referenced ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <section className="card">
        <h2>Monthly Category Budgets <span className="tx-sub">(Optional)</span></h2>
        <p className="tx-sub">Set monthly spending caps to track category utilization on Home.</p>
        <div className="budget-input-grid">
          {BUDGET_CATEGORIES.map((category) => (
            <div className="form-group" key={category}>
              <label htmlFor={`budget-${category}`}>{category} (LKR)</label>
              <input
                id={`budget-${category}`}
                type="text"
                inputMode="decimal"
                placeholder="No limit"
                value={budgetInputs[category] ?? ''}
                onChange={(event) => setBudgetInputs((previous) => ({
                  ...previous,
                  [category]: event.target.value,
                }))}
              />
            </div>
          ))}
        </div>
        <button type="button" className="primary" disabled={isSaving} onClick={() => void saveBudgets()}>
          Save Monthly Budgets
        </button>
      </section>

      <section className="card">
        <h2>Backup &amp; Restore</h2>
        <div className="form-group">
          <label htmlFor="backup-password">Optional backup password</label>
          <input
            id="backup-password"
            type="password"
            autoComplete="new-password"
            value={backupPassword}
            onChange={(event) => setBackupPassword(event.target.value)}
            placeholder="Use for encrypted export or import"
          />
          <p className="tx-sub">Keep this password safe; encrypted backups cannot be opened without it.</p>
        </div>
        <div className="form-group">
          <label>Export JSON Backup</label>
          <p className="tx-sub">
            JSON backups contain personal household expense data.
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => exportBackupFile(household)}
          >
            Export JSON Backup
          </button>
          <button type="button" onClick={() => void exportEncryptedBackup()} disabled={!backupPassword}>
            🔐 Export AES-256 Encrypted Backup
          </button>
          <div className="export-actions">
            <button type="button" onClick={() => {
              try {
                exportPdfReport(household);
              } catch (error) {
                setBackupError(error instanceof Error ? error.message : 'Could not open PDF report.');
              }
            }}>📄 Export Weekly &amp; Monthly PDF Report</button>
            <button type="button" onClick={() => exportCsvReport(household)}>📊 Export CSV Spreadsheet</button>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="backup-import">Import JSON Backup</label>
          <input
            id="backup-import"
            type="file"
            accept=".json,application/json"
            disabled={isSaving}
            onChange={handleBackupFileChange}
          />
        </div>
        {backupError && (
          <p className="amount-neg" role="alert">
            {backupError}
          </p>
        )}
        {restorePreview && (
          <div className="card" style={{ background: 'var(--surface-soft)' }}>
            <h3>Confirm Household Restore</h3>
            <p>
              Restore <strong>{restorePreview.name}</strong> with{' '}
              {restorePreview.members.length} members,{' '}
              {restorePreview.expenses.length} expenses, and{' '}
              {restorePreview.repayments.length} repayments?
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => exportBackupFile(household)}
              >
                Export Current Data First
              </button>
              <button
                type="button"
                className="primary"
                disabled={isSaving}
                onClick={() => void confirmRestore()}
              >
                Confirm Restore
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setRestorePreview(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {isAdmin && (
        <section className="card" style={{ marginTop: '0.5rem' }}>
          <h2>Demo &amp; Reset Presets</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void runReplacement('empty')}
            >
              Start Empty Ledger
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void runReplacement('demo')}
            >
              Restore Demo Ledger
            </button>
          </div>
          {pendingReplacement && (
            <div className="card" role="alert">
              <p>
                {pendingReplacement === 'empty'
                  ? 'Start Empty Ledger'
                  : 'Restore Demo Ledger'}{' '}
                will replace the current household and its records. Continue?
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="danger"
                  disabled={isSaving}
                  onClick={() => void confirmReplacement()}
                >
                  Confirm Replace
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setPendingReplacement(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
