import { useState } from 'react';
import type { Household } from './types';

type Tab = 'overview' | 'expenses' | 'repayments' | 'settings';

const SAMPLE_HOUSEHOLD: Household = {
  id: 'demo-house-1',
  name: 'Colombo Student Flat',
  currency: 'LKR',
  updatedAt: '2026-11-08',
  members: [
    { id: 'm1', name: 'Manuja' },
    { id: 'm2', name: 'Nimal' },
    { id: 'm3', name: 'Kavindu' },
  ],
  expenses: [
    {
      id: 'e1',
      title: 'Groceries',
      category: 'Groceries',
      amountCents: 300000,
      paidById: 'm1',
      date: '2026-11-06',
      splitMode: 'equal',
      shares: [
        { memberId: 'm1', amountCents: 100000 },
        { memberId: 'm2', amountCents: 100000 },
        { memberId: 'm3', amountCents: 100000 },
      ],
    },
    {
      id: 'e2',
      title: 'Electricity',
      category: 'Utilities',
      amountCents: 150000,
      paidById: 'm2',
      date: '2026-11-07',
      splitMode: 'equal',
      shares: [
        { memberId: 'm1', amountCents: 50000 },
        { memberId: 'm2', amountCents: 50000 },
        { memberId: 'm3', amountCents: 50000 },
      ],
    },
    {
      id: 'e3',
      title: 'Cleaning supplies',
      category: 'Other',
      amountCents: 60000,
      paidById: 'm3',
      date: '2026-11-08',
      splitMode: 'equal',
      shares: [
        { memberId: 'm1', amountCents: 20000 },
        { memberId: 'm2', amountCents: 20000 },
        { memberId: 'm3', amountCents: 20000 },
      ],
    },
  ],
  repayments: [],
};

const SAMPLE_BALANCES = [
  { memberId: 'm1', name: 'Manuja', balanceCents: 130000 },
  { memberId: 'm2', name: 'Nimal', balanceCents: -20000 },
  { memberId: 'm3', name: 'Kavindu', balanceCents: -110000 },
];

function formatLKR(cents: number): string {
  const rupees = cents / 100;
  return new Intl.NumberFormat('en-LK', {
    style: 'currency',
    currency: 'LKR',
    minimumFractionDigits: 2,
  }).format(rupees);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [showEmptyState, setShowEmptyState] = useState(false);

  const household = SAMPLE_HOUSEHOLD;
  const expenses = showEmptyState ? [] : household.expenses;

  const getMemberName = (id: string) =>
    household.members.find((m) => m.id === id)?.name ?? 'Unknown';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>RoomSplit</h1>
          <small>{household.name}</small>
        </div>
        <div className="row-between">
          <span className="badge">{household.currency}</span>
          <button
            type="button"
            onClick={() => setShowEmptyState((prev) => !prev)}
          >
            {showEmptyState ? 'Show Demo Data' : 'Preview Empty State'}
          </button>
        </div>
      </header>

      <nav className="tab-nav" aria-label="Primary views">
        {(['overview', 'expenses', 'repayments', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-current={activeTab === tab ? 'page' : undefined}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      <main>
        {activeTab === 'overview' && (
          <section className="stack">
            <div className="card">
              <h2>Total Household Spending</h2>
              <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
                {showEmptyState ? formatLKR(0) : formatLKR(510000)}
              </p>
            </div>

            <div className="card">
              <h2>Member Balances</h2>
              <div className="stack">
                {SAMPLE_BALANCES.map((b) => {
                  const cents = showEmptyState ? 0 : b.balanceCents;
                  return (
                    <div key={b.memberId} className="row-between">
                      <span>{b.name}</span>
                      <span className={cents > 0 ? 'amount-pos' : cents < 0 ? 'amount-neg' : ''}>
                        {cents > 0 ? `+${formatLKR(cents)}` : formatLKR(cents)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <div className="row-between">
                <h2>Suggested Repayments</h2>
                <button type="button" className="primary" onClick={() => setActiveTab('expenses')}>
                  + Add Expense
                </button>
              </div>
              {showEmptyState ? (
                <p className="empty-state">No repayments needed yet.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                  <li>Kavindu pays Manuja: <strong>{formatLKR(110000)}</strong></li>
                  <li>Nimal pays Manuja: <strong>{formatLKR(20000)}</strong></li>
                </ul>
              )}
            </div>
          </section>
        )}

        {activeTab === 'expenses' && (
          <section className="stack">
            <div className="card">
              <h2>Add Expense (Preview)</h2>
              <div className="form-group">
                <label htmlFor="exp-title">Expense Title</label>
                <input id="exp-title" type="text" placeholder="e.g., Groceries" />
              </div>
              <div className="form-group">
                <label htmlFor="exp-amount">Amount (LKR)</label>
                <input id="exp-amount" type="text" inputMode="decimal" placeholder="0.00" />
              </div>
              <button type="button" className="primary">Save Expense</button>
            </div>

            <div className="card">
              <h2>Recent Expenses</h2>
              {expenses.length === 0 ? (
                <div className="empty-state">
                  <p>No expenses recorded yet. Use the form above to add your first shared bill.</p>
                </div>
              ) : (
                <div className="stack">
                  {expenses.map((exp) => (
                    <div key={exp.id} className="row-between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                      <div>
                        <strong>{exp.title}</strong> <span className="badge">{exp.category}</span>
                        <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                          Paid by {getMemberName(exp.paidById)} on {exp.date}
                        </div>
                      </div>
                      <strong>{formatLKR(exp.amountCents)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'repayments' && (
          <section className="card">
            <h2>Record Repayment</h2>
            <p>Suggested transfers and repayment history will be wired up here.</p>
          </section>
        )}

        {activeTab === 'settings' && (
          <section className="card">
            <h2>Household & Members</h2>
            <div className="form-group">
              <label htmlFor="member-name">Add Housemate</label>
              <input id="member-name" type="text" placeholder="Enter member name" />
            </div>
            <button type="button" className="primary">Add Member</button>
          </section>
        )}
      </main>
    </div>
  );
}