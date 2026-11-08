import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Household, Repayment } from '../types';
import { calculateBalances, suggestRepayments } from '../lib/balances';
import { centsToInputString, formatMoney, parseMoney } from '../lib/money';

type Props = {
  household: Household;
  onUpdateHousehold: (next: Household) => Promise<boolean>;
  isSaving: boolean;
};

function getLocalTodayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function RepaymentManager({
  household,
  onUpdateHousehold,
  isSaving,
}: Props) {
  const balances = calculateBalances(household);
  const suggestions = suggestRepayments(balances);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [date, setDate] = useState(getLocalTodayDate);
  const [formError, setFormError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const getMemberName = (id: string) =>
    household.members.find((member) => member.id === id)?.name ?? 'Unknown';

  const handleQuickFill = (suggestion: (typeof suggestions)[number]) => {
    setFromId(suggestion.fromId);
    setToId(suggestion.toId);
    setAmountInput(centsToInputString(suggestion.amountCents));
    setFormError('');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');

    if (!fromId || !toId || fromId === toId) {
      setFormError('Choose two different housemates.');
      return;
    }
    const debtor = balances.find((balance) => balance.memberId === fromId);
    const creditor = balances.find((balance) => balance.memberId === toId);
    if (!debtor || debtor.balanceCents >= 0) {
      setFormError('The sender must currently have a negative balance.');
      return;
    }
    if (!creditor || creditor.balanceCents <= 0) {
      setFormError('The receiver must currently have a positive balance.');
      return;
    }

    const parsedAmount = parseMoney(amountInput);
    if (parsedAmount.ok === false) {
      setFormError(parsedAmount.error);
      return;
    }
    const maximumAmount = Math.min(
      Math.abs(debtor.balanceCents),
      creditor.balanceCents,
    );
    if (parsedAmount.cents > maximumAmount) {
      setFormError(
        `Amount cannot exceed the current settlement limit of ${formatMoney(maximumAmount)}.`,
      );
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setFormError('Please select a valid date (YYYY-MM-DD).');
      return;
    }
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      setFormError('Please select a valid date (YYYY-MM-DD).');
      return;
    }

    const repayment: Repayment = {
      id: crypto.randomUUID(),
      fromId,
      toId,
      amountCents: parsedAmount.cents,
      date,
    };
    const saved = await onUpdateHousehold({
      ...household,
      repayments: [repayment, ...household.repayments],
      updatedAt: getLocalTodayDate(),
    });
    if (saved) {
      setFromId('');
      setToId('');
      setAmountInput('');
      setDate(getLocalTodayDate());
    }
  };

  const handleDelete = async (repaymentId: string) => {
    const saved = await onUpdateHousehold({
      ...household,
      repayments: household.repayments.filter(
        (repayment) => repayment.id !== repaymentId,
      ),
      updatedAt: getLocalTodayDate(),
    });
    if (saved) setConfirmDeleteId(null);
  };

  return (
    <section className="stack">
      <div className="card">
        <h2>Suggested Settlements</h2>
        {suggestions.length === 0 ? (
          <p className="empty-state">No repayments needed right now.</p>
        ) : (
          <div className="tx-list">
            {suggestions.map((suggestion) => (
              <div
                key={`${suggestion.fromId}-${suggestion.toId}`}
                className="tx-row"
              >
                <div className="tx-left">
                  <div className="tx-avatar" aria-hidden="true">
                    ↗
                  </div>
                  <div className="tx-info">
                    <p className="tx-title">
                      {suggestion.fromName} pays {suggestion.toName}
                    </p>
                    <div className="tx-sub">Recommended transfer</div>
                  </div>
                </div>
                <div className="tx-right">
                  <strong className="amount-pos">
                    {formatMoney(suggestion.amountCents)}
                  </strong>
                  <div>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleQuickFill(suggestion)}
                    >
                      Quick Fill
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Record Repayment</h2>
        {household.members.length < 2 ? (
          <p className="empty-state">
            Add at least two housemates to record repayments.
          </p>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="repayment-from">From (Debtor)</label>
              <select
                id="repayment-from"
                value={fromId}
                onChange={(event) => {
                  setFromId(event.target.value);
                  setFormError('');
                }}
              >
                <option value="">Select debtor</option>
                {household.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="repayment-to">To (Creditor)</label>
              <select
                id="repayment-to"
                value={toId}
                onChange={(event) => {
                  setToId(event.target.value);
                  setFormError('');
                }}
              >
                <option value="">Select creditor</option>
                {household.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="row-between">
              <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="repayment-amount">Amount (LKR)</label>
                <input
                  id="repayment-amount"
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(event) => {
                    setAmountInput(event.target.value);
                    setFormError('');
                  }}
                  placeholder="0.00"
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="repayment-date">Date</label>
                <input
                  id="repayment-date"
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setFormError('');
                  }}
                />
              </div>
            </div>

            {formError && (
              <p className="amount-neg" role="alert">
                {formError}
              </p>
            )}
            <button type="submit" className="primary" disabled={isSaving}>
              Record Repayment
            </button>
          </form>
        )}
      </div>

      <div className="card">
        <h2>Repayment History</h2>
        {household.repayments.length === 0 ? (
          <p className="empty-state">No repayments recorded yet.</p>
        ) : (
          <div className="tx-list">
            {household.repayments.map((repayment) => (
              <div key={repayment.id} className="tx-row">
                <div className="tx-left">
                  <div className="tx-avatar" aria-hidden="true">
                    ⇄
                  </div>
                  <div className="tx-info">
                    <p className="tx-title">
                      {getMemberName(repayment.fromId)} paid{' '}
                      {getMemberName(repayment.toId)}
                    </p>
                    <div className="tx-sub">{repayment.date}</div>
                  </div>
                </div>
                <div className="tx-right">
                  <strong>{formatMoney(repayment.amountCents)}</strong>
                  <div>
                    {confirmDeleteId === repayment.id ? (
                      <>
                        <button
                          type="button"
                          className="danger"
                          disabled={isSaving}
                          onClick={() => void handleDelete(repayment.id)}
                        >
                          Confirm Delete
                        </button>{' '}
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => setConfirmDeleteId(repayment.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
