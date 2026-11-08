import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Expense, Household } from '../types';
import { centsToInputString, formatMoney, parseMoney } from '../lib/money';
import { buildCustomSplit, splitEqual } from '../lib/split';

type Props = {
    household: Household;
    onUpdateHousehold: (next: Household) => void;
    onGoToSettings: () => void;
};

const CATEGORIES = ['Groceries', 'Rent', 'Utilities', 'Other'] as const;
const MAX_TITLE_LENGTH = 80;

function getLocalTodayDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export default function ExpenseManager({
    household,
    onUpdateHousehold,
    onGoToSettings,
}: Props) {
    const members = household.members;

    // Form state (used for both Add and Edit)
    const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [category, setCategory] = useState<string>('Groceries');
    const [amountInput, setAmountInput] = useState('');
    const [date, setDate] = useState(getLocalTodayDate);
    const [paidById, setPaidById] = useState<string>(members[0]?.id ?? '');
    const [participantIds, setParticipantIds] = useState<string[]>(() =>
        members.map((m) => m.id)
    );
    const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal');
    const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
    const [formError, setFormError] = useState('');

    // Search, filter & delete confirmation state
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>('All');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    if (members.length === 0) {
        return (
            <div className="card empty-state">
                <h2>No Housemates Yet</h2>
                <p>Add at least one member in Settings before recording expenses.</p>
                <button type="button" className="primary" onClick={onGoToSettings}>
                    Go to Settings
                </button>
            </div>
        );
    }

    // Ensure paidById stays valid if members changed
    const activePaidById = members.some((m) => m.id === paidById)
        ? paidById
        : members[0].id;

    const getMemberName = (id: string) =>
        members.find((m) => m.id === id)?.name ?? 'Unknown';

    const resetForm = () => {
        setEditingExpenseId(null);
        setTitle('');
        setCategory('Groceries');
        setAmountInput('');
        setDate(getLocalTodayDate());
        setPaidById(members[0]?.id ?? '');
        setParticipantIds(members.map((m) => m.id));
        setSplitMode('equal');
        setCustomInputs({});
        setFormError('');
    };

    const handleToggleParticipant = (memberId: string) => {
        setFormError('');
        setParticipantIds((prev) =>
            prev.includes(memberId)
                ? prev.filter((id) => id !== memberId)
                : [...prev, memberId]
        );
    };

    const handleStartEdit = (exp: Expense) => {
        setEditingExpenseId(exp.id);
        setTitle(exp.title);
        setCategory(exp.category);
        setAmountInput(centsToInputString(exp.amountCents));
        setDate(exp.date);
        setPaidById(exp.paidById);
        setParticipantIds(exp.shares.map((s) => s.memberId));
        setSplitMode(exp.splitMode);

        const customMap: Record<string, string> = {};
        for (const share of exp.shares) {
            customMap[share.memberId] = centsToInputString(share.amountCents);
        }
        setCustomInputs(customMap);
        setFormError('');
    };

    // Live preview for Equal split when amount is valid
    const parsedAmountPreview = parseMoney(amountInput);
    const equalPreviewResult =
        splitMode === 'equal' && parsedAmountPreview.ok
            ? splitEqual(parsedAmountPreview.cents, participantIds)
            : null;

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        setFormError('');

        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
            setFormError('Expense title is required.');
            return;
        }
        if (trimmedTitle.length > MAX_TITLE_LENGTH) {
            setFormError(`Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
            return;
        }

        const parsedAmount = parseMoney(amountInput);
        if (!parsedAmount.ok) {
            setFormError(parsedAmount.error);
            return;
        }

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            setFormError('Please select a valid date (YYYY-MM-DD).');
            return;
        }

        if (!members.some((m) => m.id === activePaidById)) {
            setFormError('Please select a valid payer.');
            return;
        }

        // Keep only participants that exist in household
        const validParticipantIds = participantIds.filter((id) =>
            members.some((m) => m.id === id)
        );

        if (validParticipantIds.length === 0) {
            setFormError('Select at least one participant to share this expense.');
            return;
        }

        const splitResult =
            splitMode === 'equal'
                ? splitEqual(parsedAmount.cents, validParticipantIds)
                : buildCustomSplit(parsedAmount.cents, validParticipantIds, customInputs);

        if (!splitResult.ok) {
            setFormError(splitResult.error);
            return;
        }

        const nextExpense: Expense = {
            id: editingExpenseId ?? crypto.randomUUID(),
            title: trimmedTitle,
            category,
            amountCents: parsedAmount.cents,
            paidById: activePaidById,
            date,
            splitMode,
            shares: splitResult.shares,
        };

        const nextExpenses = editingExpenseId
            ? household.expenses.map((exp) =>
                exp.id === editingExpenseId ? nextExpense : exp
            )
            : [nextExpense, ...household.expenses];

        onUpdateHousehold({
            ...household,
            expenses: nextExpenses,
            updatedAt: getLocalTodayDate(),
        });

        resetForm();
    };

    const handleDeleteExpense = (expenseId: string) => {
        onUpdateHousehold({
            ...household,
            expenses: household.expenses.filter((exp) => exp.id !== expenseId),
            updatedAt: getLocalTodayDate(),
        });
        if (editingExpenseId === expenseId) {
            resetForm();
        }
        setConfirmDeleteId(null);
    };

    // Filtered expense list
    const filteredExpenses = household.expenses.filter((exp) => {
        const matchesTitle = exp.title
            .toLowerCase()
            .includes(searchQuery.trim().toLowerCase());
        const matchesCategory =
            categoryFilter === 'All' || exp.category === categoryFilter;
        return matchesTitle && matchesCategory;
    });

    return (
        <div className="stack">
            {/* Add / Edit Expense Form */}
            <section className="card">
                <h2>{editingExpenseId ? 'Edit Expense' : 'Add Expense'}</h2>
                <form onSubmit={handleSubmit} noValidate>
                    <div className="form-group">
                        <label htmlFor="exp-title">Title</label>
                        <input
                            id="exp-title"
                            type="text"
                            value={title}
                            onChange={(e) => {
                                setTitle(e.target.value);
                                setFormError('');
                            }}
                            placeholder="e.g., Groceries, Electricity"
                        />
                    </div>

                    <div className="row-between" style={{ gap: '0.75rem' }}>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label htmlFor="exp-category">Category</label>
                            <select
                                id="exp-category"
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                            >
                                {CATEGORIES.map((cat) => (
                                    <option key={cat} value={cat}>
                                        {cat}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group" style={{ flex: 1 }}>
                            <label htmlFor="exp-date">Date</label>
                            <input
                                id="exp-date"
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="row-between" style={{ gap: '0.75rem' }}>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label htmlFor="exp-amount">Amount (LKR)</label>
                            <input
                                id="exp-amount"
                                type="text"
                                inputMode="decimal"
                                value={amountInput}
                                onChange={(e) => {
                                    setAmountInput(e.target.value);
                                    setFormError('');
                                }}
                                placeholder="e.g., 3000.00"
                            />
                        </div>

                        <div className="form-group" style={{ flex: 1 }}>
                            <label htmlFor="exp-payer">Paid By</label>
                            <select
                                id="exp-payer"
                                value={activePaidById}
                                onChange={(e) => setPaidById(e.target.value)}
                            >
                                {members.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Participants Checkboxes */}
                    <fieldset
                        style={{
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            padding: '0.75rem',
                            marginBottom: '0.85rem',
                        }}
                    >
                        <legend style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                            Participants ({participantIds.length} selected)
                        </legend>
                        <div className="stack" style={{ gap: '0.5rem' }}>
                            {members.map((m) => {
                                const checked = participantIds.includes(m.id);
                                return (
                                    <label
                                        key={m.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            fontWeight: 400,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => handleToggleParticipant(m.id)}
                                            style={{ width: 'auto' }}
                                        />
                                        <span>{m.name}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </fieldset>

                    {/* Split Mode Toggle */}
                    <div className="form-group">
                        <label>Split Mode</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                                type="button"
                                className={splitMode === 'equal' ? 'primary' : ''}
                                onClick={() => {
                                    setSplitMode('equal');
                                    setFormError('');
                                }}
                            >
                                Equal Split
                            </button>
                            <button
                                type="button"
                                className={splitMode === 'custom' ? 'primary' : ''}
                                onClick={() => {
                                    setSplitMode('custom');
                                    setFormError('');
                                }}
                            >
                                Custom Exact Amounts
                            </button>
                        </div>
                    </div>

                    {/* Equal Split Preview */}
                    {splitMode === 'equal' && equalPreviewResult?.ok && (
                        <div
                            style={{
                                background: '#f1f5f9',
                                padding: '0.75rem',
                                borderRadius: '6px',
                                marginBottom: '0.85rem',
                                fontSize: '0.9rem',
                            }}
                        >
                            <strong>Equal Split Preview:</strong>
                            <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.2rem' }}>
                                {equalPreviewResult.shares.map((s) => (
                                    <li key={s.memberId}>
                                        {getMemberName(s.memberId)}: {formatMoney(s.amountCents)}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Custom Split Inputs */}
                    {splitMode === 'custom' && participantIds.length > 0 && (
                        <div
                            className="stack"
                            style={{
                                background: '#f1f5f9',
                                padding: '0.75rem',
                                borderRadius: '6px',
                                marginBottom: '0.85rem',
                            }}
                        >
                            <strong style={{ fontSize: '0.9rem' }}>
                                Enter Exact Share per Participant (LKR):
                            </strong>
                            {participantIds.map((memberId) => (
                                <div key={memberId} className="row-between">
                                    <label htmlFor={`custom-share-${memberId}`}>
                                        {getMemberName(memberId)}
                                    </label>
                                    <input
                                        id={`custom-share-${memberId}`}
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="0.00"
                                        value={customInputs[memberId] ?? ''}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setCustomInputs((prev) => ({
                                                ...prev,
                                                [memberId]: val,
                                            }));
                                            setFormError('');
                                        }}
                                        style={{ maxWidth: '180px' }}
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    {formError && (
                        <p className="amount-neg" role="alert" style={{ marginTop: 0 }}>
                            {formError}
                        </p>
                    )}

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button type="submit" className="primary">
                            {editingExpenseId ? 'Update Expense' : 'Save Expense'}
                        </button>
                        {editingExpenseId && (
                            <button type="button" onClick={resetForm}>
                                Cancel Edit
                            </button>
                        )}
                    </div>
                </form>
            </section>

            {/* Search, Filter & Expense List */}
            <section className="card">
                <h2>Expenses ({filteredExpenses.length})</h2>

                <div className="row-between" style={{ gap: '0.75rem', marginBottom: '1rem' }}>
                    <div className="form-group" style={{ flex: 2, marginBottom: 0 }}>
                        <label htmlFor="search-expenses">Search by Title</label>
                        <input
                            id="search-expenses"
                            type="search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search expenses..."
                        />
                    </div>

                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        <label htmlFor="filter-category">Category</label>
                        <select
                            id="filter-category"
                            value={categoryFilter}
                            onChange={(e) => setCategoryFilter(e.target.value)}
                        >
                            <option value="All">All Categories</option>
                            {CATEGORIES.map((cat) => (
                                <option key={cat} value={cat}>
                                    {cat}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {filteredExpenses.length === 0 ? (
                    <div className="empty-state">
                        <p>No matching expenses found.</p>
                    </div>
                ) : (
                    <div className="stack">
                        {filteredExpenses.map((exp) => (
                            <div
                                key={exp.id}
                                style={{
                                    borderBottom: '1px solid var(--border)',
                                    paddingBottom: '0.75rem',
                                }}
                            >
                                <div className="row-between">
                                    <div>
                                        <strong>{exp.title}</strong>{' '}
                                        <span className="badge">{exp.category}</span>{' '}
                                        <span className="badge">{exp.splitMode}</span>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                                            Paid by <strong>{getMemberName(exp.paidById)}</strong> on{' '}
                                            {exp.date}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                                            Shares:{' '}
                                            {exp.shares
                                                .map(
                                                    (s) =>
                                                        `${getMemberName(s.memberId)} (${formatMoney(
                                                            s.amountCents
                                                        )})`
                                                )
                                                .join(', ')}
                                        </div>
                                    </div>

                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
                                            {formatMoney(exp.amountCents)}
                                        </div>

                                        {confirmDeleteId === exp.id ? (
                                            <div style={{ display: 'flex', gap: '0.35rem' }}>
                                                <button
                                                    type="button"
                                                    className="primary"
                                                    onClick={() => handleDeleteExpense(exp.id)}
                                                    style={{ background: 'var(--negative)', borderColor: 'var(--negative)' }}
                                                >
                                                    Confirm Delete
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setConfirmDeleteId(null)}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleStartEdit(exp)}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setConfirmDeleteId(exp.id)}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}