import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Household } from '../types';

type Props = {
    household: Household;
    onUpdateHousehold: (next: Household) => void;
    onLoadDemo: () => void;
    onResetEmpty: () => void;
};

const MAX_NAME_LENGTH = 80;

export default function HouseholdSettings({
    household,
    onUpdateHousehold,
    onLoadDemo,
    onResetEmpty,
}: Props) {
    // Household name form state
    const [householdNameInput, setHouseholdNameInput] = useState(household.name);
    const [householdError, setHouseholdError] = useState('');
    const [householdSavedMsg, setHouseholdSavedMsg] = useState('');

    // Add member form state
    const [newMemberName, setNewMemberName] = useState('');
    const [addMemberError, setAddMemberError] = useState('');

    // Rename member inline state
    const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [editError, setEditError] = useState('');

    // Check if a member is referenced in any expense or repayment
    const isMemberReferenced = (memberId: string): boolean => {
        const inExpenses = household.expenses.some(
            (exp) =>
                exp.paidById === memberId ||
                exp.shares.some((share) => share.memberId === memberId)
        );
        const inRepayments = household.repayments.some(
            (rep) => rep.fromId === memberId || rep.toId === memberId
        );
        return inExpenses || inRepayments;
    };

    // Validate a member name (non-empty, <= 80 chars, unique case-insensitively)
    const validateMemberName = (rawName: string, ignoreMemberId?: string): string | null => {
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
                m.name.trim().toLowerCase() === trimmed.toLowerCase()
        );
        if (duplicate) {
            return `"${trimmed}" is already in this household.`;
        }
        return null;
    };

    // Submit household name update
    const handleHouseholdSubmit = (e: FormEvent) => {
        e.preventDefault();
        setHouseholdSavedMsg('');
        const trimmed = householdNameInput.trim();

        if (!trimmed) {
            setHouseholdError('Household name is required.');
            return;
        }
        if (trimmed.length > MAX_NAME_LENGTH) {
            setHouseholdError(`Household name must be ${MAX_NAME_LENGTH} characters or fewer.`);
            return;
        }

        setHouseholdError('');
        setHouseholdNameInput(trimmed);
        onUpdateHousehold({
            ...household,
            name: trimmed,
            updatedAt: new Date().toISOString().slice(0, 10),
        });
        setHouseholdSavedMsg('Household name updated.');
    };

    // Submit new member
    const handleAddMember = (e: FormEvent) => {
        e.preventDefault();
        const error = validateMemberName(newMemberName);
        if (error) {
            setAddMemberError(error);
            return; // Keep typed value so the user can fix it
        }

        const trimmed = newMemberName.trim();
        setAddMemberError('');
        setNewMemberName('');

        onUpdateHousehold({
            ...household,
            members: [
                ...household.members,
                { id: crypto.randomUUID(), name: trimmed },
            ],
            updatedAt: new Date().toISOString().slice(0, 10),
        });
    };

    // Start renaming a member
    const startEditingMember = (id: string, currentName: string) => {
        setEditingMemberId(id);
        setEditingName(currentName);
        setEditError('');
    };

    // Save renamed member
    const handleSaveRename = (e: FormEvent, memberId: string) => {
        e.preventDefault();
        const error = validateMemberName(editingName, memberId);
        if (error) {
            setEditError(error);
            return;
        }

        const trimmed = editingName.trim();
        onUpdateHousehold({
            ...household,
            members: household.members.map((m) =>
                m.id === memberId ? { ...m, name: trimmed } : m
            ),
            updatedAt: new Date().toISOString().slice(0, 10),
        });
        setEditingMemberId(null);
        setEditingName('');
        setEditError('');
    };

    // Delete an unreferenced member
    const handleDeleteMember = (memberId: string) => {
        if (isMemberReferenced(memberId)) return;

        onUpdateHousehold({
            ...household,
            members: household.members.filter((m) => m.id !== memberId),
            updatedAt: new Date().toISOString().slice(0, 10),
        });
    };

    return (
        <div className="stack">
            {/* Household Name Form */}
            <section className="card">
                <h2>Household Details</h2>
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
                        <label htmlFor="household-currency">Currency</label>
                        <input
                            id="household-currency"
                            type="text"
                            value="LKR (Sri Lankan Rupee)"
                            disabled
                        />
                    </div>

                    <button type="submit" className="primary">
                        Save Household Name
                    </button>
                </form>
            </section>

            {/* Add Member Form */}
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
                    <button type="submit" className="primary">
                        + Add Member
                    </button>
                </form>
            </section>

            {/* Member List */}
            <section className="card">
                <h2>Housemates ({household.members.length})</h2>
                {household.members.length === 0 ? (
                    <div className="empty-state">
                        <p>No housemates added yet. Add at least one member above before creating expenses.</p>
                    </div>
                ) : (
                    <div className="stack">
                        {household.members.map((member) => {
                            const referenced = isMemberReferenced(member.id);
                            const isEditing = editingMemberId === member.id;

                            return (
                                <div
                                    key={member.id}
                                    style={{
                                        borderBottom: '1px solid var(--border)',
                                        paddingBottom: '0.75rem',
                                    }}
                                >
                                    {isEditing ? (
                                        <form
                                            onSubmit={(e) => handleSaveRename(e, member.id)}
                                            className="stack"
                                            noValidate
                                        >
                                            <div className="form-group" style={{ marginBottom: 0 }}>
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
                                            <div className="row-between">
                                                <button type="submit" className="primary">
                                                    Save Name
                                                </button>
                                                <button
                                                    type="button"
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
                                        <div className="row-between">
                                            <div>
                                                <strong>{member.name}</strong>
                                                {referenced && (
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                                                        Linked to expenses/repayments (cannot delete)
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => startEditingMember(member.id, member.name)}
                                                >
                                                    Rename
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={referenced}
                                                    title={
                                                        referenced
                                                            ? 'Cannot delete a member referenced by an expense or repayment'
                                                            : 'Delete member'
                                                    }
                                                    onClick={() => handleDeleteMember(member.id)}
                                                    style={{
                                                        opacity: referenced ? 0.5 : 1,
                                                        cursor: referenced ? 'not-allowed' : 'pointer',
                                                    }}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Quick Demo / Reset Controls */}
            <section className="card">
                <h2>Testing & Demo Controls</h2>
                <p style={{ fontSize: '0.9rem', color: 'var(--muted)', marginTop: 0 }}>
                    Switch between an empty household (to test adding members from scratch) and the guide&apos;s demo dataset.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button type="button" onClick={onResetEmpty}>
                        Start Empty Household
                    </button>
                    <button type="button" onClick={onLoadDemo}>
                        Load Guide Demo Data
                    </button>
                </div>
            </section>
        </div>
    );
}