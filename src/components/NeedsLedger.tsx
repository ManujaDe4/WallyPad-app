import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Household, NeedItem } from '../types';
import { formatMoney, parseMoney, centsToInputString } from '../lib/money';

type Props = {
  household: Household;
  onUpdateHousehold: (next: Household) => Promise<boolean>;
  isSaving: boolean;
};

function getLocalTodayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function NeedsLedger({
  household,
  onUpdateHousehold,
  isSaving,
}: Props) {
  const [newNeedName, setNewNeedName] = useState('');
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [formError, setFormError] = useState('');
  const [itemError, setItemError] = useState('');
  const items = household.needsLedger ?? [];
  const currentMonth = getLocalTodayDate().slice(0, 7);
  const monthlySpendCents = items.reduce(
    (sum, item) => item.isChecked && item.lastPurchasedAt?.startsWith(currentMonth)
      ? sum + item.lastPriceCents
      : sum,
    0,
  );
  const sortedItems = [...items].sort(
    (left, right) => Number(left.isChecked) - Number(right.isChecked),
  );

  const handleAddNeed = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newNeedName.trim();
    setFormError('');
    if (!name) {
      setFormError('Enter the name of the recurring need.');
      return;
    }
    if (name.length > 80) {
      setFormError('Need names must be 80 characters or fewer.');
      return;
    }
    if (items.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      setFormError('That need is already on your list.');
      return;
    }
    const now = new Date().toISOString();
    const newItem: NeedItem = {
      id: crypto.randomUUID(),
      name,
      isChecked: false,
      lastPriceCents: 0,
      updatedAt: now,
    };
    const saved = await onUpdateHousehold({
      ...household,
      needsLedger: [...items, newItem],
      updatedAt: getLocalTodayDate(),
    });
    if (saved) setNewNeedName('');
  };

  const openPriceEntry = (item: NeedItem) => {
    setEditingPriceId(item.id);
    setPriceInput(centsToInputString(item.lastPriceCents));
    setItemError('');
  };

  const handleCheckOff = async (item: NeedItem) => {
    setItemError('');
    const parsedPrice = parseMoney(priceInput);
    if (parsedPrice.ok === false) {
      setItemError(parsedPrice.error);
      return;
    }
    const now = new Date().toISOString();
    const today = getLocalTodayDate();
    const nextItems = items.map((current) => current.id === item.id
      ? {
          ...current,
          isChecked: true,
          lastPriceCents: parsedPrice.cents,
          updatedAt: now,
          lastPurchasedAt: today,
        }
      : current);
    const saved = await onUpdateHousehold({
      ...household,
      needsLedger: nextItems,
      updatedAt: today,
    });
    if (saved) {
      setEditingPriceId(null);
      setPriceInput('');
    }
  };

  const handleUncheck = async (item: NeedItem) => {
    setItemError('');
    const today = getLocalTodayDate();
    const saved = await onUpdateHousehold({
      ...household,
      needsLedger: items.map((current) => current.id === item.id
        ? { ...current, isChecked: false, updatedAt: new Date().toISOString() }
        : current),
      updatedAt: today,
    });
    if (saved) setEditingPriceId(null);
  };

  const handleDelete = async (item: NeedItem) => {
    setItemError('');
    const today = getLocalTodayDate();
    const saved = await onUpdateHousehold({
      ...household,
      needsLedger: items.filter((current) => current.id !== item.id),
      deletedIds: [...new Set([...(household.deletedIds ?? []), item.id])],
      updatedAt: today,
    });
    if (saved && editingPriceId === item.id) setEditingPriceId(null);
  };

  return (
    <section className="stack needs-ledger" aria-labelledby="needs-ledger-title">
      <div className="card needs-summary">
        <div>
          <span className="needs-summary-label">Monthly Needs Spend</span>
          <h2 id="needs-ledger-title">{formatMoney(monthlySpendCents)}</h2>
        </div>
        <span className="needs-summary-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M7 3.75h7l4 4v12.5H7a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2Z" />
            <path d="M14 3.75v4h4M8.5 12h7M8.5 15.5h7" />
          </svg>
        </span>
      </div>

      <form className="card needs-add-form" onSubmit={(event) => void handleAddNeed(event)}>
        <label className="sr-only" htmlFor="new-recurring-need">Add new recurring need</label>
        <input
          id="new-recurring-need"
          value={newNeedName}
          onChange={(event) => setNewNeedName(event.target.value)}
          maxLength={80}
          placeholder="+ Add new recurring need..."
          disabled={isSaving}
        />
        <button type="submit" className="primary" disabled={isSaving}>
          Add
        </button>
        {formError && <p className="needs-error" role="alert">{formError}</p>}
      </form>

      {itemError && <p className="needs-error" role="alert">{itemError}</p>}
      {sortedItems.length === 0 ? (
        <div className="empty-state">
          <p>Your recurring essentials will live here.</p>
          <p>Add your first need, like rice or soap.</p>
        </div>
      ) : (
        <div className="needs-list" aria-label="Recurring needs">
          {sortedItems.map((item) => (
            <article className={`needs-item ${item.isChecked ? 'is-checked' : ''}`} key={item.id}>
              <div className="needs-item-main">
                <button
                  type="button"
                  className={`needs-checkbox ${item.isChecked ? 'checked' : ''}`}
                  aria-label={item.isChecked ? `Mark ${item.name} as needed` : `Mark ${item.name} as bought`}
                  aria-pressed={item.isChecked}
                  disabled={isSaving}
                  onClick={() => item.isChecked ? void handleUncheck(item) : openPriceEntry(item)}
                >
                  {item.isChecked && (
                    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path d="m4.5 10 3.5 3.5 7.5-7.5" />
                    </svg>
                  )}
                </button>
                <span className="needs-item-name">{item.name}</span>
                <span className="needs-item-price">
                  {item.lastPriceCents > 0 ? formatMoney(item.lastPriceCents) : '—'}
                </span>
                <button
                  type="button"
                  className="needs-delete"
                  aria-label={`Delete ${item.name}`}
                  disabled={isSaving}
                  onClick={() => void handleDelete(item)}
                >
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M4.5 6h11m-9.5 0 .6 10h6.8l.6-10M8 6V4h4v2m-3 3v4m2-4v4" />
                  </svg>
                </button>
              </div>
              {editingPriceId === item.id && (
                <form
                  className="needs-price-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleCheckOff(item);
                  }}
                >
                  <label htmlFor={`need-price-${item.id}`}>Price paid? (LKR)</label>
                  <div className="needs-price-controls">
                    <input
                      id={`need-price-${item.id}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={priceInput}
                      onChange={(event) => setPriceInput(event.target.value)}
                      autoFocus
                      disabled={isSaving}
                    />
                    <button type="submit" className="primary" disabled={isSaving}>
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingPriceId(null)}
                      disabled={isSaving}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
