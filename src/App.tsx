import { useState } from 'react';
import type { Household } from './types';
import HouseholdSettings from './components/HouseholdSettings';

type Tab = 'overview' | 'expenses' | 'repayments' | 'settings';

const DEMO_HOUSEHOLD: Household = {
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

function createEmptyHousehold(): Household {
  return {
    id: crypto.randomUUID(),
    name: 'My Household',
    currency: 'LKR',
    members: [],
    expenses: [],
    repayments: [],
    updatedAt: new Date().toISOString().slice(0, 10),
  };
}

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
  const [household, setHousehold] = useState<Household>(DEMO_HOUSEHOLD);

  const hasMembers = household.members.length > 0;

  const getMemberName = (id: string) =>
    household.members.find((m) => m.id === id)?.name ?? 'Unknown';

  // Simple balance calculation from current state (expanded into src/lib in Session 5)
  const totalSpendingCents = household.expenses.reduce(
    (sum, exp) => sum + exp.amountCents,
    0
  );

  const memberBalances = household.members.map((member) => {
    let balanceCents = 0;
    for (const exp of household.expenses) {
      if (exp.paidById === member.id) {
        balanceCents += exp.amountCents;
      }
      const share = exp.shares.find((s) => s.memberId === member.id);
      if (share) {
        balanceCents -= share.amountCents;
      }
    }
    return { memberId: member.id, name: member.name, balanceCents };
  });

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>RoomSplit</h1>
          <small>{household.name}</small>
        </div>
        <div className="row-between">
          <span className="badge">{household.currency}</span>
          <span className="badge">{household.members.length} Members</span>
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
                {formatLKR(totalSpendingCents)}
              </p>
            </div>

            <div className="card">
              <div className="row-between">
                <h2>Member Balances</h2>
                {!hasMembers && (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => setActiveTab('settings')}
                  >
                    + Add Housemates First
                  </button>
                )}
              </div>
              {!hasMembers ? (
                <p className="empty-state">
                  No members in this household yet. Open Settings to add housemates.
                </p>
              ) : (
                <div className="stack">
                  {memberBalances.map((b) => (
                    <div key={b.memberId} className="row-between">
                      <span>{b.name}</span>
                      <span
                        className={
                          b.balanceCents > 0
                            ? 'amount-pos'
                            : b.balanceCents < 0
                              ? 'amount-neg'
                              : ''
                        }
                      >
                        {b.balanceCents > 0
                          ? `+${formatLKR(b.balanceCents)}`
                          : formatLKR(b.balanceCents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="row-between">
                <h2>Quick Actions</h2>
                <button
                  type="button"
                  className="primary"
                  disabled={!hasMembers}
                  onClick={() => setActiveTab('expenses')}
                  style={{ opacity: hasMembers ? 1 : 0.5 }}
                >
                  + Add Expense
                </button>
              </div>
              {!hasMembers && (
                <small style={{ color: 'var(--muted)' }}>
                  Expense creation is disabled until you add at least one household member.
                </small>
              )}
            </div>
          </section>
        )}

        {activeTab === 'expenses' && (
          <section className="stack">
            <div className="card">
              <h2>Add Expense</h2>
              {!hasMembers ? (
                <div className="empty-state">
                  <p>You must add at least one member before adding an expense.</p>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => setActiveTab('settings')}
                  >
                    Go to Settings to Add Members
                  </button>
                </div>
              ) : (
                <p style={{ color: 'var(--muted)', margin: 0 }}>
                  Full Add/Edit/Delete expense form comes next in Session 4!
                </p>
              )}
            </div>

            <div className="card">
              <h2>Recent Expenses</h2>
              {household.expenses.length === 0 ? (
                <div className="empty-state">
                  <p>No expenses recorded yet.</p>
                </div>
              ) : (
                <div className="stack">
                  {household.expenses.map((exp) => (
                    <div
                      key={exp.id}
                      className="row-between"
                      style={{
                        borderBottom: '1px solid var(--border)',
                        paddingBottom: '0.5rem',
                      }}
                    >
                      <div>
                        <strong>{exp.title}</strong>{' '}
                        <span className="badge">{exp.category}</span>
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
            <p>Suggested transfers and repayment history will be wired up in Sessions 5 & 7.</p>
          </section>
        )}

        {activeTab === 'settings' && (
          <HouseholdSettings
            household={household}
            onUpdateHousehold={setHousehold}
            onLoadDemo={() => setHousehold(DEMO_HOUSEHOLD)}
            onResetEmpty={() => setHousehold(createEmptyHousehold())}
          />
        )}
      </main>
    </div>
  );
}