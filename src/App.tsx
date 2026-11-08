import { useState } from 'react';
import type { Household } from './types';
import HouseholdSettings from './components/HouseholdSettings';
import ExpenseManager from './components/ExpenseManager';
import { formatMoney } from './lib/money';
import {
  calculateBalances,
  calculateTotalSpending,
  suggestRepayments,
} from './lib/balances';

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

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [household, setHousehold] = useState<Household>(DEMO_HOUSEHOLD);

  const hasMembers = household.members.length > 0;
  const totalSpendingCents = calculateTotalSpending(household);
  const memberBalances = calculateBalances(household);
  const suggestedTransfers = suggestRepayments(memberBalances);

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
                {formatMoney(totalSpendingCents)}
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
                    <div
                      key={b.memberId}
                      className="row-between"
                      style={{
                        borderBottom: '1px solid var(--border)',
                        paddingBottom: '0.5rem',
                      }}
                    >
                      <div>
                        <strong>{b.name}</strong>
                        <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                          Paid {formatMoney(b.paidCents)} • Share{' '}
                          {formatMoney(b.owedSharesCents)}
                        </div>
                      </div>
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
                          ? `+${formatMoney(b.balanceCents)}`
                          : formatMoney(b.balanceCents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="row-between">
                <h2>Suggested Repayments</h2>
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
              {suggestedTransfers.length === 0 ? (
                <p className="empty-state">
                  All settled up! No repayments needed right now.
                </p>
              ) : (
                <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
                  {suggestedTransfers.map((t) => (
                    <li key={`${t.fromId}-${t.toId}`} style={{ marginBottom: '0.35rem' }}>
                      <strong>{t.fromName}</strong> → <strong>{t.toName}</strong>:{' '}
                      <strong>{formatMoney(t.amountCents)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {activeTab === 'expenses' && (
          <ExpenseManager
            household={household}
            onUpdateHousehold={setHousehold}
            onGoToSettings={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'repayments' && (
          <section className="card">
            <h2>Record Repayment</h2>
            <p>
              Persistence (Session 6) and Repayment recording (Session 7) come next!
            </p>
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