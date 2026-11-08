import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { Household } from '../types';
import { exportBackupFile, validateBackupJson } from '../lib/backup';

type Props = {
  household: Household;
  onUpdateHousehold: (next: Household) => Promise<boolean>;
  onLoadDemo: () => Promise<boolean>;
  onResetEmpty: () => Promise<boolean>;
  isSaving: boolean;
};

const MAX_NAME_LENGTH = 80;
type ReplacementAction = 'empty' | 'demo';

export default function HouseholdSettings({
  household,
  onUpdateHousehold,
  onLoadDemo,
  onResetEmpty,
  isSaving,
}: Props) {
  const [householdNameInput, setHouseholdNameInput] = useState(household.name);
  const [lastHouseholdName, setLastHouseholdName] = useState(household.name);
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

    setHouseholdError('');
    setHouseholdNameInput(trimmed);
    const saved = await onUpdateHousehold({
      ...household,
      name: trimmed,
      updatedAt: new Date().toISOString().slice(0, 10),
    });
    if (saved) setHouseholdSavedMsg('Household name updated.');
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
      updatedAt: new Date().toISOString().slice(0, 10),
    });
  };

  const handleBackupFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    setBackupError('');
    setRestorePreview(null);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setBackupError('Backup file must be 2 MB or smaller.');
      return;
    }
    try {
      const result = validateBackupJson(await file.text());
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
    if (saved) setPendingReplacement(null);
  };

  const confirmRestore = async () => {
    if (!restorePreview) return;
    const saved = await onUpdateHousehold(restorePreview);
    if (saved) {
      setRestorePreview(null);
      setBackupError('');
    }
  };

  return (
    <div className="stack">
      <section className="card">
        <h2>Household Profile</h2>
        <form onSubmit={handleHouseholdSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="household-name">Household Name</label>
            <input
              id="household-name"
              type="text"
              value={householdNameInput}
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
            <label htmlFor="household-currency">Ledger Currency</label>
            <input
              id="household-currency"
              type="text"
              value="LKR — Sri Lankan Rupee"
              disabled
            />
          </div>

          <button type="submit" className="primary" disabled={isSaving}>
            Save Profile
          </button>
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
                        {member.name.charAt(0).toUpperCase()}
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
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <section className="card">
        <h2>Backup &amp; Restore</h2>
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
    </div>
  );
}
