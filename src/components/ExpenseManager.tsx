import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import type { Expense, Household } from '../types';
import { centsToInputString, formatMoney } from '../lib/money';
import { buildCustomSplit, splitEqual } from '../lib/split';
import { buildSupermarketSplit, evaluateMoneyExpression } from '../lib/mathInput';

type Props = {
  household: Household;
  onUpdateHousehold: (next: Household) => Promise<boolean>;
  isSaving: boolean;
  onGoToSettings: () => void;
};

const CATEGORIES = ['Groceries', 'Rent', 'Utilities', 'Other'] as const;
const MAX_TITLE_LENGTH = 80;

const CATEGORY_ICONS: Record<string, string> = {
  Groceries: '🛒',
  Rent: '🏠',
  Utilities: '⚡',
  Other: '🧾',
};

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
  isSaving,
  onGoToSettings,
}: Props) {
  const members = household.members;

  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('Groceries');
  const [amountInput, setAmountInput] = useState('');
  const [date, setDate] = useState(getLocalTodayDate);
  const [paidById, setPaidById] = useState<string>(members[0]?.id ?? '');
  const [participantIds, setParticipantIds] = useState<string[]>(() =>
    members.map((m) => m.id),
  );
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal');
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [deductPersonalItems, setDeductPersonalItems] = useState(false);
  const [personalInputs, setPersonalInputs] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (members.length === 0) {
    return (
      <div className="card empty-state">
        <h2>No Housemates Yet</h2>
        <p>
          Add at least one housemate in Settings before recording expenses.
        </p>
        <button type="button" className="primary" onClick={onGoToSettings}>
          Go to Settings
        </button>
      </div>
    );
  }

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
    setDeductPersonalItems(false);
    setPersonalInputs({});
    setFormError('');
  };

  const handleToggleParticipant = (memberId: string) => {
    setFormError('');
    setParticipantIds((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId],
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
    setDeductPersonalItems(false);
    setPersonalInputs({});
    setFormError('');
  };

  const parsedAmountPreview = amountInput.trim()
    ? evaluateMoneyExpression(amountInput)
    : null;
  const equalPreviewResult =
    splitMode === 'equal' && parsedAmountPreview?.ok
      ? deductPersonalItems
        ? buildSupermarketSplit(
            parsedAmountPreview.cents,
            participantIds,
            personalInputs,
          )
        : splitEqual(parsedAmountPreview.cents, participantIds)
      : null;

  const handleSubmit = async (e: FormEvent) => {
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

    const parsedAmount = evaluateMoneyExpression(amountInput);
    if (parsedAmount.ok === false) {
      setFormError(parsedAmount.error);
      return;
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setFormError('Please select a valid date (YYYY-MM-DD).');
      return;
    }

    const validParticipantIds = participantIds.filter((id) =>
      members.some((m) => m.id === id),
    );

    if (validParticipantIds.length === 0) {
      setFormError('Select at least one participant to share this expense.');
      return;
    }

    const splitResult =
      splitMode === 'equal'
        ? deductPersonalItems
          ? buildSupermarketSplit(
              parsedAmount.cents,
              validParticipantIds,
              personalInputs,
            )
          : splitEqual(parsedAmount.cents, validParticipantIds)
        : buildCustomSplit(
            parsedAmount.cents,
            validParticipantIds,
            customInputs,
          );

    if (splitResult.ok === false) {
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
          exp.id === editingExpenseId ? nextExpense : exp,
        )
      : [nextExpense, ...household.expenses];

    const saved = await onUpdateHousehold({
      ...household,
      expenses: nextExpenses,
      updatedAt: getLocalTodayDate(),
    });

    if (saved) resetForm();
  };

  const handleDeleteExpense = async (expenseId: string) => {
    const saved = await onUpdateHousehold({
      ...household,
      expenses: household.expenses.filter((exp) => exp.id !== expenseId),
      deletedIds: [...new Set([...(household.deletedIds ?? []), expenseId])],
      updatedAt: getLocalTodayDate(),
    });
    if (!saved) return;
    if (editingExpenseId === expenseId) {
      resetForm();
    }
    setConfirmDeleteId(null);
  };

  const filteredExpenses = household.expenses.filter((exp) => {
    const matchesTitle = exp.title
      .toLowerCase()
      .includes(searchQuery.trim().toLowerCase());
    const matchesCategory =
      categoryFilter === 'All' || exp.category === categoryFilter;
    return matchesTitle && matchesCategory;
  });

  return (
    <div>
      <section className="card">
        <h2>{editingExpenseId ? 'Edit Expense' : 'New Shared Expense'}</h2>
        {!editingExpenseId && (
          <div className="export-actions" aria-label="Quick-fill expense presets">
            {[
              { label: '⚡ CEB Electricity', title: 'CEB Electricity', category: 'Utilities' },
              { label: '🏠 Monthly Rent', title: 'Monthly Rent', category: 'Rent' },
              { label: '🌐 Wi-Fi', title: 'Wi-Fi', category: 'Utilities' },
              { label: '🛒 Weekly Groceries', title: 'Weekly Groceries', category: 'Groceries' },
            ].map((preset) => (
              <button
                type="button"
                className="preset-chip"
                key={preset.title}
                onClick={() => {
                  setTitle(preset.title);
                  setCategory(preset.category);
                  setPaidById(activePaidById);
                  setParticipantIds(members.map((member) => member.id));
                  setFormError('');
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}

        {/* Segmented Split Mode Switcher */}
        <div
          className="segmented"
          role="group"
          aria-label="Split mode"
          style={{ '--n': 2, '--i': splitMode === 'equal' ? 0 : 1 } as CSSProperties}
        >
          <span className="seg-thumb" aria-hidden="true" />
          <button
            type="button"
            className={`seg-btn ${splitMode === 'equal' ? 'active' : ''}`}
            aria-pressed={splitMode === 'equal'}
            onClick={() => {
              setSplitMode('equal');
              setFormError('');
            }}
          >
            Equal Split
          </button>
          <button
            type="button"
            className={`seg-btn ${splitMode === 'custom' ? 'active' : ''}`}
            aria-pressed={splitMode === 'custom'}
            onClick={() => {
              setSplitMode('custom');
              setFormError('');
            }}
          >
            Custom Shares
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="exp-title">Expense Title</label>
            <input
              id="exp-title"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setFormError('');
              }}
              placeholder="e.g., Groceries, Wi-Fi Bill"
            />
          </div>

          <div className="row-between">
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
                onBlur={() => {
                  const result = evaluateMoneyExpression(amountInput);
                  if (result.ok) setAmountInput(centsToInputString(result.cents));
                }}
                placeholder="0.00"
              />
              {parsedAmountPreview?.ok && (
                <small className="tx-sub">
                  <span className="money">
                  = {formatMoney(parsedAmountPreview.cents)}
                  </span>
                </small>
              )}
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

          <div className="row-between">
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

          <fieldset className="card">
            <legend>
              Split Between ({participantIds.length} selected)
            </legend>
            <div className="row-between">
              {members.map((m) => {
                const checked = participantIds.includes(m.id);
                return (
                  <label
                    key={m.id}
                    htmlFor={`participant-${m.id}`}
                    className={`participant-chip ${checked ? 'selected' : ''}`}
                  >
                    <input
                      id={`participant-${m.id}`}
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggleParticipant(m.id)}
                    />
                    <span>{m.name}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {splitMode === 'equal' && equalPreviewResult?.ok && (
            <div className="card">
              <strong>Equal Split Preview:</strong>
              <div className="export-actions">
                {equalPreviewResult.shares.map((s) => (
                  <span
                    key={s.memberId}
                    className="participant-chip"
                  >
                    {getMemberName(s.memberId)}:{' '}
                    <strong className="money">{formatMoney(s.amountCents)}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {splitMode === 'equal' && (
            <details className="card">
              <summary>+ Deduct personal items first?</summary>
              <div className="form-group">
                <label className="participant-chip">
                  <input
                    type="checkbox"
                    checked={deductPersonalItems}
                    onChange={(event) => setDeductPersonalItems(event.target.checked)}
                  />
                  Enter each member's personal item total
                </label>
              </div>
              {deductPersonalItems && participantIds.map((memberId) => (
                <div className="form-group" key={memberId}>
                  <label htmlFor={`personal-${memberId}`}>{getMemberName(memberId)}</label>
                  <input
                    id={`personal-${memberId}`}
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={personalInputs[memberId] ?? ''}
                    onChange={(event) => setPersonalInputs((previous) => ({
                      ...previous,
                      [memberId]: event.target.value,
                    }))}
                  />
                </div>
              ))}
              {deductPersonalItems && equalPreviewResult?.ok && (
                <p className="tx-sub">
                  Personal items are added to each member's equal share of the remaining total.
                </p>
              )}
              {deductPersonalItems && equalPreviewResult?.ok === false && parsedAmountPreview?.ok && (
                <p className="amount-neg" role="alert">{equalPreviewResult.error}</p>
              )}
            </details>
          )}

          {splitMode === 'custom' && participantIds.length > 0 && (
            <div
              className="card"
            >
              <strong>
                Custom Share per Housemate (LKR):
              </strong>
              {participantIds.map((memberId) => (
                <div key={memberId} className="form-group">
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
                  />
                </div>
              ))}
            </div>
          )}

          {formError && (
            <p
              className="amount-neg"
              role="alert"
            >
              {formError}
            </p>
          )}

          <div className="row-between">
            <button
              type="submit"
              className="primary"
              disabled={isSaving}
            >
              {editingExpenseId ? 'Update Expense' : '+ Save Expense'}
            </button>
            {editingExpenseId && (
              <button type="button" className="ghost" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      {/* Filter Bar */}
      <section className="card">
        <div className="row-between">
          <div className="form-group" style={{ flex: 2 }}>
            <label htmlFor="search-expenses">Search Bills</label>
            <input
              id="search-expenses"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by title..."
            />
          </div>

          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="filter-category">Category</label>
            <select
              id="filter-category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="All">All</option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Expense Cards */}
      <div className="section-head">
        <h2>Transactions ({filteredExpenses.length})</h2>
      </div>

      {filteredExpenses.length === 0 ? (
        <div className="empty-state">No matching expenses found.</div>
      ) : (
        <div className="tx-list">
          {filteredExpenses.map((exp, index) => (
            <article
              key={exp.id}
              className="tx-row"
              style={{ '--i': Math.min(index, 7) } as CSSProperties}
            >
              <div className="tx-left">
                <div className="tx-avatar" aria-hidden="true">
                  {CATEGORY_ICONS[exp.category] ?? '🧾'}
                </div>
                <div className="tx-info">
                  <p className="tx-title">{exp.title}</p>
                  <div className="tx-sub">
                    Paid by <strong>{getMemberName(exp.paidById)}</strong> · {exp.date}
                  </div>
                  <div className="tx-sub">
                    {exp.shares.map((share, shareIndex) => (
                      <span key={share.memberId}>
                        {shareIndex > 0 ? ' · ' : ''}
                        {getMemberName(share.memberId)}:{' '}
                        <span className="money">{formatMoney(share.amountCents)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="tx-right">
                <strong className="tx-amount money">{formatMoney(exp.amountCents)}</strong>
                <span className="pill">{exp.splitMode}</span>
                {confirmDeleteId === exp.id ? (
                  <div className="export-actions">
                    <button
                      type="button"
                      className="danger"
                      disabled={isSaving}
                      onClick={() => void handleDeleteExpense(exp.id)}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={isSaving}
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="export-actions">
                    <button
                      type="button"
                      className="ghost"
                      disabled={isSaving}
                      onClick={() => handleStartEdit(exp)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={isSaving}
                      onClick={() => setConfirmDeleteId(exp.id)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
