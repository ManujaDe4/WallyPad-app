import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { Household, Space, SpaceAccent } from './types';
import HouseholdSettings from './components/HouseholdSettings';
import ExpenseManager from './components/ExpenseManager';
import RepaymentManager from './components/RepaymentManager';
import { formatMoney } from './lib/money';
import {
  loadActiveSpaceId,
  loadHousehold,
  loadSpacesIndex,
  saveHousehold,
  saveSpace,
  setActiveSpaceId,
  updateSpaceAccent,
} from './lib/storage';
import {
  buildWeeklyAndMonthlySummaries,
  decodeShareSnapshot,
  exportPdfReport,
  type ShareSnapshot,
} from './lib/reports';
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

/** Splits formatted money into whole and fractional parts for the Hero card */
function splitHeroCurrency(cents: number): { whole: string; decimals: string } {
  const formatted = formatMoney(cents);
  const dotIndex = formatted.lastIndexOf('.');
  if (dotIndex === -1) {
    return { whole: formatted, decimals: '.00' };
  }
  return {
    whole: formatted.slice(0, dotIndex),
    decimals: formatted.slice(dotIndex),
  };
}

const CATEGORY_COLORS: Record<string, string> = {
  Groceries: '#D97706',
  Utilities: '#2A9D8F',
  Rent: '#2563EB',
  Other: '#7C3AED',
};
export default function App() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [household, setHousehold] = useState<Household | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [failedNextState, setFailedNextState] = useState<Household | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceIdState] = useState('');
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<ShareSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [periodFilter, setPeriodFilter] = useState<'all' | 'month' | 'week'>('all');
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        let spacesIndex = await loadSpacesIndex();
        let savedHousehold = await loadHousehold();
        if (cancelled) return;
        if (!savedHousehold) {
          savedHousehold = DEMO_HOUSEHOLD;
          await saveHousehold(savedHousehold);
          spacesIndex = await loadSpacesIndex();
        }
        const selectedSpaceId = await loadActiveSpaceId();
        if (cancelled) return;
        const activeSpace = spacesIndex.find((space) => space.id === selectedSpaceId) ?? spacesIndex[0];
        setSpaces(spacesIndex);
        setActiveSpaceIdState(activeSpace?.id ?? '');
        setHousehold(activeSpace?.household ?? savedHousehold);
        const snapshotParam = new URLSearchParams(window.location.search).get('snapshot');
        if (snapshotParam) {
          try {
            setSnapshot(decodeShareSnapshot(snapshotParam));
          } catch (error) {
            setSnapshotError(getErrorMessage(error));
          }
        }
      } catch (error) {
        if (!cancelled) {
          setStorageError(
            `Could not load your saved household: ${getErrorMessage(error)}`,
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  const commitHousehold = async (nextState: Household): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setIsSaving(true);
    setStorageError('');
    setFailedNextState(null);
    try {
      await saveHousehold(nextState);
      setHousehold(nextState);
      setSpaces((previous) => previous.map((space) => (
        space.id === activeSpaceId
          ? { ...space, name: nextState.name, household: nextState }
          : space
      )));
      return true;
    } catch (error) {
      setFailedNextState(nextState);
      setStorageError(`Could not save changes: ${getErrorMessage(error)}`);
      return false;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const retrySave = async () => {
    if (failedNextState) {
      const retryState = failedNextState;
      await commitHousehold(retryState);
      return;
    }
    setStorageError('');
    setIsLoading(true);
    try {
      let savedHousehold = await loadHousehold();
      if (!savedHousehold) {
        savedHousehold = DEMO_HOUSEHOLD;
        await saveHousehold(savedHousehold);
      }
      const spacesIndex = await loadSpacesIndex();
      const selectedSpaceId = await loadActiveSpaceId();
      const activeSpace = spacesIndex.find((space) => space.id === selectedSpaceId);
      setSpaces(spacesIndex);
      setActiveSpaceIdState(activeSpace?.id ?? '');
      setHousehold(activeSpace?.household ?? savedHousehold);
    } catch (error) {
      setStorageError(
        `Could not load your saved household: ${getErrorMessage(error)}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const switchSpace = async (spaceId: string) => {
    if (savingRef.current) return;
    try {
      await setActiveSpaceId(spaceId);
      const next = spaces.find((space) => space.id === spaceId);
      if (next) {
        setActiveSpaceIdState(spaceId);
        setHousehold(next.household);
        setSpacesOpen(false);
        setStorageError('');
      }
    } catch (error) {
      setStorageError(`Could not switch Space: ${getErrorMessage(error)}`);
    }
  };

  const createSpace = async () => {
    if (savingRef.current) return;
    const id = crypto.randomUUID();
    const nextHousehold: Household = {
      id,
      name: `New Space ${spaces.length + 1}`,
      currency: 'LKR',
      members: [],
      expenses: [],
      repayments: [],
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    try {
      const saved = await saveSpace({
        id,
        name: nextHousehold.name,
        accent: 'cyan',
        household: nextHousehold,
      });
      await setActiveSpaceId(id);
      setSpaces((previous) => [...previous, saved]);
      setActiveSpaceIdState(id);
      setHousehold(saved.household);
      setSpacesOpen(false);
    } catch (error) {
      setStorageError(`Could not create Space: ${getErrorMessage(error)}`);
    }
  };

  const changeAccent = async (accent: SpaceAccent) => {
    if (!activeSpaceId || !household || savingRef.current) return;
    try {
      await updateSpaceAccent(activeSpaceId, accent);
      setHousehold((previous) => previous ? { ...previous, themeAccent: accent } : previous);
      setSpaces((previous) => previous.map((space) => (
        space.id === activeSpaceId
          ? { ...space, accent, household: { ...space.household, themeAccent: accent } }
          : space
      )));
    } catch (error) {
      setStorageError(`Could not update Space theme: ${getErrorMessage(error)}`);
    }
  };

  const dismissSnapshot = () => {
    setSnapshot(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('snapshot');
    window.history.replaceState({}, '', url);
  };

  if (isLoading || household === null) {
    return (
      <div className="app-shell">
        <div className="card" role="status" aria-live="polite">
          <h2>{isLoading ? 'Loading your household…' : 'Storage unavailable'}</h2>
          {storageError && <p className="amount-neg">{storageError}</p>}
          {!isLoading && storageError && (
            <button type="button" className="primary" onClick={retrySave}>
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const hasMembers = household.members.length > 0;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const todayText = `${currentMonth}-${String(now.getDate()).padStart(2, '0')}`;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekStartText = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
  const filteredExpenses = household.expenses.filter((expense) => {
    if (periodFilter === 'month') return expense.date.startsWith(currentMonth);
    if (periodFilter === 'week') return expense.date >= weekStartText && expense.date <= todayText;
    return true;
  });
  const totalSpendingCents = filteredExpenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const allTimeSpendingCents = calculateTotalSpending(household);
  const reportSummaries = buildWeeklyAndMonthlySummaries(household.expenses);
  const monthCategoryTotals = new Map<string, number>();
  for (const expense of household.expenses.filter((entry) => entry.date.startsWith(currentMonth))) {
    monthCategoryTotals.set(
      expense.category,
      (monthCategoryTotals.get(expense.category) ?? 0) + expense.amountCents,
    );
  }
  const snapshotTransfers = snapshot?.transfers ?? [];
  const memberBalances = calculateBalances(household);
  const suggestedTransfers = suggestRepayments(memberBalances);
  const heroParts = splitHeroCurrency(totalSpendingCents);

  // Calculate settled (repayment) totals
  const totalRepaidCents = household.repayments.reduce(
    (sum, r) => sum + r.amountCents,
    0,
  );
  const totalUnsettledCents = suggestedTransfers.reduce(
    (sum, t) => sum + t.amountCents,
    0,
  );

  // Category breakdown
  const categoryTotals = new Map<string, number>();
  for (const exp of filteredExpenses) {
    categoryTotals.set(
      exp.category,
      (categoryTotals.get(exp.category) ?? 0) + exp.amountCents,
    );
  }
  const sortedCategories = [...categoryTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const getMemberName = (id: string) =>
    household.members.find((m) => m.id === id)?.name ?? 'Unknown';

  return (
    <div className="app-shell" data-accent={household.themeAccent ?? 'cyan'}>
      {/* Top Neo-Bank Profile Pill Header */}
      <header className="top-pill-bar" data-accent={household.themeAccent ?? 'cyan'}>
        <button
          type="button"
          className="header-space-trigger"
          aria-expanded={spacesOpen}
          aria-haspopup="dialog"
          onClick={() => setSpacesOpen((open) => !open)}
        >
          <div className="profile-cluster">
            <div className="avatar-circle" aria-hidden="true">
              {household.name.charAt(0).toUpperCase()}
            </div>
            <div className="profile-meta">
              <h1 className="profile-title">{household.name}</h1>
              <span className="profile-sub">
                @RoomSplit • {household.members.length} Housemates · Switch Space
              </span>
            </div>
          </div>
        </button>
        <div className="pill-badges">
          <span className="icon-chip">{household.currency}</span>
          <span className="icon-chip">{household.expenses.length} bills</span>
        </div>
      </header>

      <main>
        {spacesOpen && (
          <div className="spaces-modal-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSpacesOpen(false);
          }}>
            <section className="spaces-modal card" role="dialog" aria-modal="true" aria-labelledby="spaces-title">
              <div className="row-between">
                <h2 id="spaces-title">Your Spaces</h2>
                <button type="button" onClick={() => setSpacesOpen(false)} aria-label="Close Spaces">×</button>
              </div>
              <div className="space-list">
                {spaces.map((space) => (
                  <div className="space-row" key={space.id}>
                    <button
                      type="button"
                      className={`space-select ${space.id === activeSpaceId ? 'selected' : ''}`}
                      onClick={() => void switchSpace(space.id)}
                    >
                      <span className={`space-color ${space.accent}`} />
                      <span>{space.name}</span>
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" className="primary" onClick={() => void createSpace()}>+ Create Space</button>
              <div className="form-group accent-picker">
                <span>Theme accent</span>
                <div className="accent-options">
                  {(['cyan', 'emerald', 'amber', 'indigo'] as const).map((accent) => (
                    <button
                      key={accent}
                      type="button"
                      aria-label={`${accent} accent`}
                      aria-pressed={(household.themeAccent ?? 'cyan') === accent}
                      className={`accent-dot ${accent}`}
                      onClick={() => void changeAccent(accent)}
                    />
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}
        {needRefresh && (
          <div className="update-prompt" role="status" aria-live="polite">
            <p>
              A new version of RoomSplit is available — Save or cancel any open
              form before updating
            </p>
            <div className="update-prompt-actions">
              <button
                type="button"
                className="primary"
                onClick={() => void updateServiceWorker(true)}
              >
                Update Now
              </button>
              <button
                type="button"
                className="update-dismiss"
                onClick={() => setNeedRefresh(false)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {snapshotError && (
          <div className="card amount-neg" role="alert">{snapshotError}</div>
        )}
        {snapshot && (
          <section className="snapshot-banner card" aria-label="Shared Settlement Snapshot">
            <div className="row-between">
              <div>
                <h2>Shared Settlement Snapshot</h2>
                <p className="tx-sub">{snapshot.name} · Read-only</p>
              </div>
              <button type="button" onClick={dismissSnapshot}>Return to my ledger</button>
            </div>
            {snapshotTransfers.length ? snapshotTransfers.map((transfer) => (
              <div className="row-between snapshot-transfer" key={`${transfer.fromId}-${transfer.toId}`}>
                <span>{transfer.fromName} → {transfer.toName}</span>
                <strong>{formatMoney(transfer.amountCents)}</strong>
              </div>
            )) : <p className="empty-state">Everyone is settled up.</p>}
            <div className="snapshot-balances">
              {snapshot.balances.map((balance) => (
                <div className="row-between" key={balance.memberId}>
                  <span>{balance.name}</span>
                  <strong className={balance.balanceCents > 0 ? 'amount-pos' : balance.balanceCents < 0 ? 'amount-neg' : ''}>
                    {balance.balanceCents > 0 ? '+' : ''}{formatMoney(balance.balanceCents)}
                  </strong>
                </div>
              ))}
            </div>
            <p className="tx-sub">Total spend: {formatMoney(snapshot.totalSpendingCents)}</p>
          </section>
        )}
        {storageError && (
          <div
            className="card"
            role="alert"
            style={{ borderColor: 'var(--negative)', marginBottom: '1rem' }}
          >
            <p className="amount-neg" style={{ marginTop: 0 }}>
              {storageError}
            </p>
            <button
              type="button"
              className="primary"
              disabled={isSaving}
              onClick={retrySave}
            >
              Retry
            </button>
          </div>
        )}
        {!snapshot && activeTab === 'overview' && (
          <section>
            <div className="home-tools">
              <div className="period-filter" role="group" aria-label="Spending period">
                {([
                  ['all', 'All Time'],
                  ['month', 'This Month'],
                  ['week', 'This Week'],
                ] as const).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={periodFilter === value ? 'active' : ''}
                    aria-pressed={periodFilter === value}
                    onClick={() => setPeriodFilter(value)}
                  >{label}</button>
                ))}
              </div>
              <button type="button" className="report-button" onClick={() => {
                try {
                  exportPdfReport(household);
                } catch (error) {
                  setStorageError(getErrorMessage(error));
                }
              }}>📄 PDF Report</button>
            </div>
            {/* Cyan Gradient Hero Card */}
            <div className="hero-card">
              <div className="hero-label">
                <span>{periodFilter === 'all' ? 'Total Household Spending' : periodFilter === 'month' ? 'This Month' : 'This Week'}</span>
                <span>{filteredExpenses.length} Bills</span>
              </div>
              <div className="hero-amount">
                {heroParts.whole}
                <span className="cents-part">{heroParts.decimals}</span>
              </div>
              <p className="hero-sub">
                {suggestedTransfers.length === 0
                  ? 'All housemate balances are settled'
                  : `${suggestedTransfers.length} suggested transfer(s) to settle up`}
              </p>
              <div className="hero-actions">
                <button
                  type="button"
                  className="btn-hero-solid"
                  disabled={!hasMembers}
                  onClick={() => setActiveTab('expenses')}
                >
                  + Add Expense
                </button>
                <button
                  type="button"
                  className="btn-hero-glass"
                  onClick={() => setActiveTab('repayments')}
                >
                  ↗ Settle Up
                </button>
              </div>
            </div>

            {/* Split Summary Bar (dark navy) */}
            <div className="split-summary-bar">
              <div className="summary-metric">
                <span className="metric-label">
                  <span className="arrow-up" aria-hidden="true">
                    ↑
                  </span>{' '}
                  Total Settled
                </span>
                <span className="metric-value">
                  {formatMoney(totalRepaidCents)}
                </span>
              </div>
              <div
                className="summary-divider"
                role="separator"
                aria-hidden="true"
              />
              <div className="summary-metric" style={{ textAlign: 'right' }}>
                <span className="metric-label" style={{ justifyContent: 'flex-end' }}>
                  <span className="arrow-down" aria-hidden="true">
                    ↓
                  </span>{' '}
                  Unsettled
                </span>
                <span className="metric-value">
                  {formatMoney(totalUnsettledCents)}
                </span>
              </div>
            </div>

            {/* 2-Column Member Balances Grid ("Accounts" style) */}
            <div className="section-head">
              <h2>Housemate Balances</h2>
              <button
                type="button"
                className="link-btn"
                onClick={() => setActiveTab('settings')}
              >
                Manage ›
              </button>
            </div>

            {!hasMembers ? (
              <div className="empty-state">
                <p>No housemates added yet.</p>
                <button
                  type="button"
                  className="primary"
                  onClick={() => setActiveTab('settings')}
                >
                  + Add Housemates
                </button>
              </div>
            ) : (
              <div className="accounts-grid">
                {memberBalances.map((b) => {
                  const statusClass =
                    b.balanceCents > 0
                      ? 'pos'
                      : b.balanceCents < 0
                        ? 'neg'
                        : 'neutral';
                  const pctOfTotal =
                    allTimeSpendingCents > 0
                      ? Math.round((b.paidCents / allTimeSpendingCents) * 100)
                      : 0;
                  return (
                    <div key={b.memberId} className="account-card">
                      <div className={`account-icon ${statusClass}`}>
                        {b.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="account-name">{b.name}</div>
                      <div
                        className={`account-balance ${
                          b.balanceCents > 0
                            ? 'amount-pos'
                            : b.balanceCents < 0
                              ? 'amount-neg'
                              : ''
                        }`}
                      >
                        {b.balanceCents > 0
                          ? `+${formatMoney(b.balanceCents)}`
                          : formatMoney(b.balanceCents)}
                      </div>
                      <div className="account-meta">
                        Paid {formatMoney(b.paidCents)}
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${pctOfTotal}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Category Breakdown Cards */}
            {sortedCategories.length > 0 && (
              <>
                <div className="section-head">
                  <h2>Spending by Category</h2>
                </div>
                <div className="category-scroll">
                  {sortedCategories.map(([cat, cents], idx) => (
                    <div
                      key={cat}
                      className="category-card"
                      style={{
                        background:
                          CATEGORY_COLORS[cat] ?? '#6B7280',
                      }}
                    >
                      <span className="cat-rank">{idx + 1}</span>
                      <div className="cat-name">{cat}</div>
                      <div className="cat-amount">{formatMoney(cents)}</div>
                      {household.categoryBudgetsCents?.[cat] !== undefined && household.categoryBudgetsCents[cat] > 0 && (
                        <div className="budget-meter">
                          {(() => {
                            const percentage = Math.round(((monthCategoryTotals.get(cat) ?? 0) / household.categoryBudgetsCents[cat]) * 100);
                            return <>
                              <span>{percentage}% of monthly cap</span>
                              <span className={`budget-track ${percentage >= 100 ? 'over' : percentage >= 80 ? 'near' : ''}`}>
                                <span style={{ width: `${Math.min(percentage, 100)}%` }} />
                              </span>
                            </>;
                          })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            <details className="card report-preview">
              <summary>Weekly &amp; Monthly Breakdown</summary>
              <h3>Recent Weeks</h3>
              {reportSummaries.weekly.slice(0, 4).map((row) => (
                <div className="row-between report-row" key={row.period}>
                  <span>{row.period}<small>{row.billCount} bills · {row.topCategory}</small></span>
                  <strong>{formatMoney(row.totalCents)}</strong>
                </div>
              ))}
              <h3>Recent Months</h3>
              {reportSummaries.monthly.slice(0, 3).map((row) => (
                <div className="row-between report-row" key={row.period}>
                  <span>{row.period}<small>{row.billCount} bills</small></span>
                  <strong>{formatMoney(row.totalCents)}</strong>
                </div>
              ))}
            </details>

            {/* Suggested Repayments List ("Recent Transactions" style) */}
            <div className="section-head">
              <h2>Suggested Settlements</h2>
              <button
                type="button"
                className="link-btn"
                onClick={() => setActiveTab('repayments')}
              >
                View All ›
              </button>
            </div>

            {suggestedTransfers.length === 0 ? (
              <div className="empty-state">
                All settled up! Every housemate is at LKR 0.00.
              </div>
            ) : (
              <div className="tx-list">
                {suggestedTransfers.map((t) => (
                  <div key={`${t.fromId}-${t.toId}`} className="tx-row">
                    <div className="tx-left">
                      <div
                        className="tx-avatar"
                        style={{
                          background: '#fef2f2',
                          color: 'var(--negative)',
                        }}
                      >
                        ↗
                      </div>
                      <div className="tx-info">
                        <p className="tx-title">
                          {t.fromName} → {t.toName}
                        </p>
                        <div className="tx-sub">Suggested settlement</div>
                      </div>
                    </div>
                    <div className="tx-right">
                      <div className="amount-pos">
                        {formatMoney(t.amountCents)}
                      </div>
                      <div className="tx-sub">Pending</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent Expenses Preview */}
            <div className="section-head">
              <h2>Recent Bills</h2>
              <button
                type="button"
                className="link-btn"
                onClick={() => setActiveTab('expenses')}
              >
                See All ›
              </button>
            </div>

            {household.expenses.length === 0 ? (
              <div className="empty-state">No expenses recorded yet.</div>
            ) : (
              <div className="tx-list">
                {household.expenses.slice(0, 3).map((exp) => (
                  <div key={exp.id} className="tx-row">
                    <div className="tx-left">
                      <div className="tx-avatar">
                        {exp.title.charAt(0).toUpperCase()}
                      </div>
                      <div className="tx-info">
                        <p className="tx-title">{exp.title}</p>
                        <div className="tx-sub">
                          {exp.date} • Paid by {getMemberName(exp.paidById)}
                        </div>
                      </div>
                    </div>
                    <div className="tx-right">
                      <div style={{ fontWeight: 800 }}>
                        {formatMoney(exp.amountCents)}
                      </div>
                      <div className="tx-sub">{exp.category}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {!snapshot && activeTab === 'expenses' && (
          <ExpenseManager
            key={activeSpaceId}
            household={household}
            onUpdateHousehold={commitHousehold}
            isSaving={isSaving}
            onGoToSettings={() => setActiveTab('settings')}
          />
        )}

        {!snapshot && activeTab === 'repayments' && (
          <RepaymentManager
            key={activeSpaceId}
            household={household}
            onUpdateHousehold={commitHousehold}
            isSaving={isSaving}
          />
        )}

        {!snapshot && activeTab === 'settings' && (
          <HouseholdSettings
            key={activeSpaceId}
            household={household}
            onUpdateHousehold={commitHousehold}
            onLoadDemo={() => commitHousehold(DEMO_HOUSEHOLD)}
            onResetEmpty={() => commitHousehold(createEmptyHousehold())}
            isSaving={isSaving}
          />
        )}
      </main>

      {/* Floating Neo-Bank Bottom Dock Navigation */}
      {!snapshot && <div className="bottom-dock-wrap">
        <nav className="bottom-dock" aria-label="Primary navigation">
          <button
            type="button"
            className="dock-item"
            aria-current={activeTab === 'overview' ? 'page' : undefined}
            onClick={() => setActiveTab('overview')}
          >
            <span className="dock-icon" aria-hidden="true">
              🏠
            </span>
            <span>Home</span>
          </button>

          <button
            type="button"
            className="dock-item"
            aria-current={activeTab === 'expenses' ? 'page' : undefined}
            onClick={() => setActiveTab('expenses')}
          >
            <span className="dock-icon" aria-hidden="true">
              🧾
            </span>
            <span>Bills</span>
          </button>

          <button
            type="button"
            className="dock-fab"
            aria-label="Add Expense"
            onClick={() => setActiveTab('expenses')}
          >
            +
          </button>

          <button
            type="button"
            className="dock-item"
            aria-current={activeTab === 'repayments' ? 'page' : undefined}
            onClick={() => setActiveTab('repayments')}
          >
            <span className="dock-icon" aria-hidden="true">
              ⇄
            </span>
            <span>Settle</span>
          </button>

          <button
            type="button"
            className="dock-item"
            aria-current={activeTab === 'settings' ? 'page' : undefined}
            onClick={() => setActiveTab('settings')}
          >
            <span className="dock-icon" aria-hidden="true">
              ⚙️
            </span>
            <span>Settings</span>
          </button>
        </nav>
      </div>}
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown storage error.';
}
