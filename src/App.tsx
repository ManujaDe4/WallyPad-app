import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { Session } from '@supabase/supabase-js';
import type { Household, LocalIdentity, Member, Space, SpaceAccent } from './types';
import AuthScreen from './components/AuthScreen';
import HouseholdSettings from './components/HouseholdSettings';
import ExpenseManager from './components/ExpenseManager';
import OnboardingModal from './components/OnboardingModal';
import RepaymentManager from './components/RepaymentManager';
import NeedsLedger from './components/NeedsLedger';
import { formatMoney } from './lib/money';
import {
  loadActiveSpaceId,
  loadHousehold,
  loadLocalIdentity,
  loadSpacesIndex,
  saveHousehold,
  saveLocalIdentity,
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
import {
  isCloudConfigured,
  getSupabaseClient,
  joinRoomSync,
  mergeHouseholds,
  pushOrMergeRoom,
  subscribeToRoom,
} from './lib/cloudSync';
import { setLocalMemberId } from './lib/identity';

type Tab = 'overview' | 'expenses' | 'needs' | 'repayments' | 'settings';
type MainAppProps = {
  session: Session;
  onSignOut: () => Promise<void>;
};

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
    name: 'My WallyPad',
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

function getRemoteHousehold(payload: unknown): Household | null {
  let value = payload;
  if (typeof value !== 'object' || value === null) return null;
  if ('new' in value) value = value.new;
  if (typeof value !== 'object' || value === null) return null;
  for (const key of [
    'household',
    'payload',
    'household_data',
    'room_data',
    'room_payload',
    'household_json',
    'data',
  ]) {
    if (key in value) {
      value = (value as Record<string, unknown>)[key];
      break;
    }
  }
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (
    typeof value !== 'object' || value === null ||
    !('id' in value) || typeof value.id !== 'string' ||
    !('name' in value) || typeof value.name !== 'string' ||
    !('currency' in value) || value.currency !== 'LKR' ||
    !('members' in value) || !Array.isArray(value.members) ||
    !('expenses' in value) || !Array.isArray(value.expenses) ||
    !('repayments' in value) || !Array.isArray(value.repayments) ||
    ('needsLedger' in value && (
      !Array.isArray(value.needsLedger) ||
      !value.needsLedger.every((item) =>
        typeof item === 'object' && item !== null &&
        'id' in item && typeof item.id === 'string' &&
        'name' in item && typeof item.name === 'string' &&
        'isChecked' in item && typeof item.isChecked === 'boolean' &&
        'lastPriceCents' in item && typeof item.lastPriceCents === 'number' &&
        Number.isSafeInteger(item.lastPriceCents) && item.lastPriceCents >= 0 &&
        (!('updatedAt' in item) || typeof item.updatedAt === 'string') &&
        (!('lastPurchasedAt' in item) || typeof item.lastPurchasedAt === 'string')
      )
    )) ||
    !('updatedAt' in value) || typeof value.updatedAt !== 'string'
  ) return null;
  return value as Household;
}

type BlockColor = 'lime' | 'sun' | 'coral' | 'sky' | 'violet';

const CATEGORY_BLOCKS = new Map<string, BlockColor>([
  ['Groceries', 'lime'],
  ['Rent', 'violet'],
  ['Utilities', 'sky'],
  ['Other', 'sun'],
]);
const BLOCK_CYCLE: BlockColor[] = ['coral', 'lime', 'sky', 'sun', 'violet'];

/** Stable colour for a category; unknown categories hash into the palette. */
function categoryBlock(category: string): BlockColor {
  const known = CATEGORY_BLOCKS.get(category);
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < category.length; i += 1) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  }
  return BLOCK_CYCLE[hash % BLOCK_CYCLE.length];
}

const SUPPORTS_VIEW_TRANSITIONS =
  typeof document !== 'undefined' && 'startViewTransition' in document;
const VIEW_CLASS = SUPPORTS_VIEW_TRANSITIONS ? 'view' : 'view view-enter';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function haptic() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(8);
  }
}

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

const IconHome = () => (
  <svg {...iconProps}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" /></svg>
);
const IconBills = () => (
  <svg {...iconProps}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6" /></svg>
);
const IconList = () => (
  <svg {...iconProps}>
    <path d="M7 3.75h10a2 2 0 0 1 2 2v14.5H5V5.75a2 2 0 0 1 2-2Z" />
    <path d="m8 10 1.5 1.5L12 9m2 1h3m-9 5 1.5 1.5L12 14m2 1h3" />
  </svg>
);
const IconSettings = () => (
  <svg {...iconProps}>
    <path d="M4 7h9M19 7h1M4 17h1M11 17h9" /><circle cx="16" cy="7" r="2.5" /><circle cx="8" cy="17" r="2.5" />
  </svg>
);
const IconPlus = () => (
  <svg {...iconProps} strokeWidth={2.6}><path d="M12 5v14M5 12h14" /></svg>
);
const IconArrow = () => (
  <svg {...iconProps} strokeWidth={2.4}><path d="M7 17 17 7M8 7h9v9" /></svg>
);
const IconChevron = () => (
  <svg {...iconProps} strokeWidth={2.4}><path d="m6 9 6 6 6-6" /></svg>
);
const IconClose = () => (
  <svg {...iconProps} strokeWidth={2.4}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
const IconDoc = () => (
  <svg {...iconProps}><path d="M7 3h7l5 5v13H7Z" /><path d="M14 3v5h5" /></svg>
);

/** Hero amount that counts up smoothly (instant under reduced motion). */
function AnimatedMoney({ cents }: { cents: number }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? cents : 0));
  const fromRef = useRef(shown);

  useEffect(() => {
    const from = fromRef.current;
    const duration = prefersReducedMotion() ? 0 : 520;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = duration === 0 ? 1 : Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(from + (cents - from) * eased);
      fromRef.current = value;
      setShown(value);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [cents]);

  const parts = splitHeroCurrency(shown);
  return (
    <>
      {parts.whole}
      <span className="cents-part">{parts.decimals}</span>
    </>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let active = true;
    let authEventReceived = false;
    let unsubscribe: (() => void) | undefined;

    const initializeAuth = async () => {
      try {
        const supabase = getSupabaseClient();
        const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          authEventReceived = true;
          if (!active) return;
          setSession(nextSession);
          setAuthError('');
          setIsAuthLoading(false);
        });
        unsubscribe = () => data.subscription.unsubscribe();

        const { data: sessionData, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (active && !authEventReceived) setSession(sessionData.session);
      } catch (error) {
        if (active) {
          setAuthError(
            error instanceof Error
              ? error.message
              : 'Could not check your sign-in status.',
          );
        }
      } finally {
        if (active) setIsAuthLoading(false);
      }
    };

    void initializeAuth();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const handleSignOut = async () => {
    const { error } = await getSupabaseClient().auth.signOut();
    if (error) throw error;
  };

  if (isAuthLoading) {
    return (
      <main className="app-shell" data-accent="cyan" aria-busy="true">
        <header className="top-pill-bar" data-accent="cyan">
          <span className="skeleton-item skeleton-pill" aria-hidden="true" />
        </header>
        <span className="sr-only" role="status">Checking your sign-in status…</span>
      </main>
    );
  }

  if (!session) {
    return (
      <AuthScreen
        startupError={authError}
        onClearStartupError={() => setAuthError('')}
      />
    );
  }

  return <MainApp session={session} onSignOut={handleSignOut} />;
}

function MainApp({ session, onSignOut }: MainAppProps) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const storedTheme = localStorage.getItem('wallypad_theme');
    const legacyTheme = localStorage.getItem('roomsplit_theme');
    if (!storedTheme && legacyTheme) {
      localStorage.setItem('wallypad_theme', legacyTheme);
      localStorage.removeItem('roomsplit_theme');
    }
    return (storedTheme ?? legacyTheme) === 'dark' ? 'dark' : 'light';
  });
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [household, setHousehold] = useState<Household | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [failedNextState, setFailedNextState] = useState<Household | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceIdState] = useState('');
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceNickname, setNewSpaceNickname] = useState('');
  const [createSpaceError, setCreateSpaceError] = useState('');
  const [createSpaceBusy, setCreateSpaceBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<ShareSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [joinPrompt, setJoinPrompt] = useState<{ roomCode: string; pin: string } | null>(null);
  const [joinError, setJoinError] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [onboardingHousehold, setOnboardingHousehold] = useState<Household | null>(null);
  const [onboardingIdentity, setOnboardingIdentity] = useState<LocalIdentity | null>(null);
  const [onboardingError, setOnboardingError] = useState('');
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );
  const [liveSyncRoomCode, setLiveSyncRoomCode] = useState<string | null>(null);
  const [periodFilter, setPeriodFilter] = useState<'all' | 'month' | 'week'>('all');
  const savingRef = useRef(false);
  const syncingRef = useRef(false);
  const syncRetryBlockedRef = useRef(false);
  const householdRef = useRef<Household | null>(null);
  const activeSpaceIdRef = useRef('');
  const spacesRef = useRef(spaces);
  const autoJoinKeyRef = useRef('');
  const onboardingSpaceIdRef = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('wallypad_theme', theme);
    localStorage.removeItem('roomsplit_theme');
  }, [theme]);

  useEffect(() => {
    householdRef.current = household;
    activeSpaceIdRef.current = activeSpaceId;
    spacesRef.current = spaces;
  }, [activeSpaceId, household, spaces]);

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
        const url = new URL(window.location.href);
        const joinCode = url.searchParams.get('join');
        if (joinCode) {
          setJoinPrompt({
            roomCode: joinCode,
            pin: url.searchParams.get('pin') ?? '',
          });
          url.searchParams.delete('join');
          url.searchParams.delete('pin');
          window.history.replaceState({}, '', url);
        }
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
    const stateToSave = nextState.syncRoomCode && nextState.syncPinHash
      ? { ...nextState, pendingSync: true }
      : nextState;
    try {
      await saveHousehold(stateToSave);
      if (stateToSave.pendingSync) syncRetryBlockedRef.current = false;
      setHousehold(stateToSave);
      setSpaces((previous) => previous.map((space) => (
        space.id === activeSpaceId
          ? { ...space, name: stateToSave.name, household: stateToSave }
          : space
      )));
      return true;
    } catch (error) {
      setFailedNextState(stateToSave);
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

  const closeSpaces = () => {
    setSpacesOpen(false);
    setCreatingSpace(false);
    setCreateSpaceError('');
  };

  const switchSpace = async (spaceId: string) => {
    if (savingRef.current) return;
    try {
      await setActiveSpaceId(spaceId);
      const next = spaces.find((space) => space.id === spaceId);
      if (next) {
        setActiveSpaceIdState(spaceId);
        setHousehold(next.household);
        closeSpaces();
        setStorageError('');
      }
    } catch (error) {
      setStorageError(`Could not switch Space: ${getErrorMessage(error)}`);
    }
  };

  const createSpace = async (event: FormEvent) => {
    event.preventDefault();
    const name = newSpaceName.trim();
    const nickname = newSpaceNickname.trim();
    if (!name || !nickname) {
      setCreateSpaceError('Enter both a Space name and your nickname.');
      return;
    }
    if (name.length > 80 || nickname.length > 80) {
      setCreateSpaceError('Names must be 80 characters or fewer.');
      return;
    }
    if (savingRef.current || createSpaceBusy) return;
    setCreateSpaceBusy(true);
    setCreateSpaceError('');
    const id = crypto.randomUUID();
    const creator: Member = { id: crypto.randomUUID(), name: nickname };
    const nextHousehold: Household = {
      id,
      name,
      currency: 'LKR',
      members: [creator],
      expenses: [],
      repayments: [],
      adminId: creator.id,
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    try {
      setLocalMemberId(id, creator.id);
      const saved = await saveSpace({
        id,
        name,
        accent: 'cyan',
        household: nextHousehold,
      });
      await setActiveSpaceId(id);
      await saveHousehold(saved.household);
      setSpaces((previous) => [...previous, saved]);
      setActiveSpaceIdState(id);
      setHousehold(saved.household);
      setSpacesOpen(false);
      setCreatingSpace(false);
      setNewSpaceName('');
      setNewSpaceNickname('');
    } catch (error) {
      setCreateSpaceError(`Could not create Space: ${getErrorMessage(error)}`);
    } finally {
      setCreateSpaceBusy(false);
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

  const persistCloudHousehold = useCallback(async (
    targetSpaceId: string,
    nextHousehold: Household,
  ): Promise<void> => {
    const targetSpace = spacesRef.current.find((space) => space.id === targetSpaceId);
    if (!targetSpace) throw new Error('The synced Space could not be found.');
    const saved = await saveSpace({
      ...targetSpace,
      name: nextHousehold.name,
      household: nextHousehold,
    });
    setSpaces((previous) => previous.map((space) => (
      space.id === targetSpaceId ? saved : space
    )));
    if (activeSpaceIdRef.current === targetSpaceId) setHousehold(saved.household);
  }, []);

  const addJoinedHousehold = useCallback(async (
    joined: Household,
    id: string = crypto.randomUUID(),
    localMemberId?: string,
  ): Promise<boolean> => {
    try {
      if (localMemberId) setLocalMemberId(joined.id, localMemberId);
      const saved = await saveSpace({
        id,
        name: joined.name,
        accent: joined.themeAccent ?? 'cyan',
        household: joined,
      });
      await setActiveSpaceId(id);
      setSpaces((previous) => [...previous, saved]);
      setActiveSpaceIdState(id);
      setHousehold(saved.household);
      setSpacesOpen(false);
      setActiveTab('overview');
      setStorageError('');
      return true;
    } catch (error) {
      setStorageError(`Could not save the joined household: ${getErrorMessage(error)}`);
      return false;
    }
  }, []);

  const handleJoinedHousehold = useCallback(async (joined: Household): Promise<void> => {
    const identity = await loadLocalIdentity();
    window.history.replaceState({}, document.title, window.location.pathname);
    setJoinBusy(false);
    const identityMember = identity && joined.members.find(
      (member) => member.name.trim().toLowerCase() === identity.name.trim().toLowerCase(),
    );
    if (identityMember) {
      if (await addJoinedHousehold(joined, crypto.randomUUID(), identityMember.id)) {
        setJoinPrompt(null);
      }
      else setJoinError('Could not save this shared household locally.');
      return;
    }
    setOnboardingIdentity(identity);
    setOnboardingHousehold(joined);
    setOnboardingError('');
    setJoinPrompt(null);
  }, [addJoinedHousehold]);

  const confirmJoinRoom = async () => {
    if (!joinPrompt) return;
    setJoinError('');
    setJoinBusy(true);
    try {
      const joined = await joinRoomSync(joinPrompt.roomCode, joinPrompt.pin);
      await handleJoinedHousehold(joined);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Could not join this room.');
    } finally {
      setJoinBusy(false);
    }
  };

  useEffect(() => {
    if (
      isLoading || !joinPrompt || !/^\d{4}$/.test(joinPrompt.pin) ||
      !isCloudConfigured()
    ) return;
    const inviteKey = `${joinPrompt.roomCode.trim().toUpperCase()}:${joinPrompt.pin}`;
    if (autoJoinKeyRef.current === inviteKey) return;
    autoJoinKeyRef.current = inviteKey;
    let active = true;
    setJoinBusy(true);
    setJoinError('');
    void joinRoomSync(joinPrompt.roomCode, joinPrompt.pin)
      .then(async (joined) => {
        if (active) await handleJoinedHousehold(joined);
      })
      .catch((error: unknown) => {
        if (active) {
          setJoinError(error instanceof Error ? error.message : 'Could not join this room.');
        }
      })
      .finally(() => {
        if (active) setJoinBusy(false);
      });
    return () => {
      active = false;
    };
  }, [isLoading, joinPrompt, handleJoinedHousehold]);

  const finishOnboarding = async (nickname: string, avatar: string): Promise<void> => {
    if (!onboardingHousehold) return;
    const member: Member = {
      id: crypto.randomUUID(),
      name: nickname,
      avatar,
    };
    const nextHousehold: Household = {
      ...onboardingHousehold,
      members: [...onboardingHousehold.members, member],
      updatedAt: new Date().toISOString().slice(0, 10),
      pendingSync: true,
    };
    setOnboardingBusy(true);
    setOnboardingError('');
    syncingRef.current = true;
    try {
      await saveLocalIdentity({ name: nickname, avatar });
      const spaceId = onboardingSpaceIdRef.current ?? crypto.randomUUID();
      onboardingSpaceIdRef.current = spaceId;
      if (!await addJoinedHousehold(nextHousehold, spaceId, member.id)) {
        throw new Error('Could not save the joined household locally.');
      }
      const syncedHousehold = await pushOrMergeRoom(nextHousehold);
      if (syncedHousehold.pendingSync) syncRetryBlockedRef.current = true;
      await saveHousehold(syncedHousehold);
      setHousehold(syncedHousehold);
      setSpaces((previous) => previous.map((space) => (
        space.id === spaceId
          ? { ...space, name: syncedHousehold.name, household: syncedHousehold }
          : space
      )));
      setOnboardingHousehold(null);
      setOnboardingIdentity(null);
      onboardingSpaceIdRef.current = null;
    } catch (error) {
      setOnboardingError(
        error instanceof Error ? error.message : 'Could not finish joining the household.',
      );
    } finally {
      syncingRef.current = false;
      setOnboardingBusy(false);
      if (
        !syncRetryBlockedRef.current &&
        typeof navigator !== 'undefined' && navigator.onLine &&
        householdRef.current?.pendingSync
      ) {
        setHousehold((previous) => previous?.pendingSync
          ? { ...previous }
          : previous);
      }
    }
  };

  const syncNow = async (): Promise<boolean> => {
    if (!household || !activeSpaceId || syncingRef.current) return false;
    const sentHousehold = household;
    const spaceId = activeSpaceId;
    syncingRef.current = true;
    syncRetryBlockedRef.current = false;
    try {
      const result = await pushOrMergeRoom(sentHousehold);
      if (
        activeSpaceIdRef.current !== spaceId ||
        householdRef.current?.syncRoomCode !== sentHousehold.syncRoomCode
      ) return false;
      const latest = householdRef.current;
      if (!latest) return false;
      const changedLocally = latest !== sentHousehold;
      const merged = mergeHouseholds(latest, result, result.deletedIds ?? []);
      const next = {
        ...merged,
        pendingSync: result.pendingSync || changedLocally,
      };
      if (result.pendingSync) syncRetryBlockedRef.current = true;
      await persistCloudHousehold(spaceId, next);
      return !next.pendingSync;
    } catch (error) {
      syncRetryBlockedRef.current = true;
      setStorageError(`Could not save synced changes: ${getErrorMessage(error)}`);
      return false;
    } finally {
      syncingRef.current = false;
      if (
        !syncRetryBlockedRef.current &&
        typeof navigator !== 'undefined' && navigator.onLine &&
        householdRef.current?.pendingSync
      ) {
        setHousehold((previous) => previous?.pendingSync
          ? { ...previous }
          : previous);
      }
    }
  };

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncRetryBlockedRef.current = false;
      setHousehold((previous) => previous?.pendingSync
        ? { ...previous }
        : previous);
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const roomCode = household?.syncRoomCode;
    const hasCloudRoom = Boolean(
      isCloudConfigured() && roomCode && household?.syncPinHash,
    );
    const isPending = Boolean(household?.pendingSync || !isOnline);

    if (!hasCloudRoom || !roomCode) return;
    if (!isPending) {
      const timeoutId = window.setTimeout(
        () => setLiveSyncRoomCode(roomCode),
        0,
      );
      return () => window.clearTimeout(timeoutId);
    }
    if (liveSyncRoomCode !== roomCode) return;

    const timeoutId = window.setTimeout(() => setLiveSyncRoomCode(null), 1000);
    return () => window.clearTimeout(timeoutId);
  }, [
    household?.pendingSync,
    household?.syncPinHash,
    household?.syncRoomCode,
    isOnline,
    liveSyncRoomCode,
  ]);

  useEffect(() => {
    const currentHousehold = householdRef.current;
    if (
      !isCloudConfigured() || !currentHousehold?.syncRoomCode ||
      !currentHousehold.syncPinHash || !activeSpaceId
    ) return;
    const roomCode = currentHousehold.syncRoomCode;
    const spaceId = activeSpaceId;
    let active = true;
    try {
      const unsubscribe = subscribeToRoom(roomCode, (payload) => {
        const remote = getRemoteHousehold(payload);
        const local = householdRef.current;
        if (
          !active || !remote || !local ||
          activeSpaceIdRef.current !== spaceId ||
          local.syncRoomCode !== roomCode ||
          remote.syncRoomCode !== roomCode
        ) return;
        if (
          remote.lastSyncedAt &&
          remote.lastSyncedAt === local.lastSyncedAt
        ) return;
        const merged = mergeHouseholds(local, remote, remote.deletedIds ?? []);
        void persistCloudHousehold(spaceId, { ...merged, pendingSync: true })
          .catch((error: unknown) => {
            setStorageError(`Could not save a live room update: ${getErrorMessage(error)}`);
          });
      });
      if (!currentHousehold.pendingSync && !syncingRef.current) {
        const initialHousehold = currentHousehold;
        syncingRef.current = true;
        void pushOrMergeRoom(initialHousehold)
          .then(async (syncedHousehold) => {
            const latest = householdRef.current;
            if (
              !latest || activeSpaceIdRef.current !== spaceId ||
              latest.syncRoomCode !== roomCode
            ) return;
            const changedLocally = latest !== initialHousehold;
            const merged = mergeHouseholds(
              latest,
              syncedHousehold,
              syncedHousehold.deletedIds ?? [],
            );
            const next = {
              ...merged,
              pendingSync: syncedHousehold.pendingSync || changedLocally,
            };
            if (syncedHousehold.pendingSync) syncRetryBlockedRef.current = true;
            await persistCloudHousehold(spaceId, next);
          })
          .catch((error: unknown) => {
            syncRetryBlockedRef.current = true;
            setStorageError(`Could not save initial room sync: ${getErrorMessage(error)}`);
          })
          .finally(() => {
            syncingRef.current = false;
            if (
              !syncRetryBlockedRef.current &&
              typeof navigator !== 'undefined' && navigator.onLine &&
              householdRef.current?.pendingSync
            ) {
              setHousehold((previous) => previous?.pendingSync
                ? { ...previous }
                : previous);
            }
          });
      }
      return () => {
        active = false;
        unsubscribe();
      };
    } catch (error) {
      const message = `Could not subscribe to live room updates: ${getErrorMessage(error)}`;
      window.setTimeout(() => setStorageError(message), 0);
      return;
    }
  }, [
    activeSpaceId,
    household?.syncRoomCode,
    household?.syncPinHash,
    persistCloudHousehold,
  ]);

  useEffect(() => {
    if (
      !isOnline || !isCloudConfigured() || !household?.pendingSync ||
      !household.syncRoomCode || !household.syncPinHash || !activeSpaceId ||
      syncingRef.current || syncRetryBlockedRef.current
    ) return;
    const sentHousehold = household;
    const spaceId = activeSpaceId;
    syncingRef.current = true;
    void pushOrMergeRoom(sentHousehold)
      .then(async (syncedHousehold) => {
        const latest = householdRef.current;
        if (
          !latest || activeSpaceIdRef.current !== spaceId ||
          latest.syncRoomCode !== sentHousehold.syncRoomCode
        ) return;
        const hasNewerLocalChanges = latest !== sentHousehold;
        const merged = mergeHouseholds(
          latest,
          syncedHousehold,
          syncedHousehold.deletedIds ?? [],
        );
        const next = {
          ...merged,
          pendingSync: syncedHousehold.pendingSync || hasNewerLocalChanges,
        };
        if (syncedHousehold.pendingSync) syncRetryBlockedRef.current = true;
        await persistCloudHousehold(spaceId, next);
      })
      .catch((error: unknown) => {
        syncRetryBlockedRef.current = true;
        setStorageError(`Could not save sync status: ${getErrorMessage(error)}`);
      })
      .finally(() => {
        syncingRef.current = false;
        if (
          !syncRetryBlockedRef.current &&
          typeof navigator !== 'undefined' && navigator.onLine &&
          householdRef.current?.pendingSync
        ) {
          setHousehold((previous) => previous?.pendingSync
            ? { ...previous }
            : previous);
        }
      });
  }, [activeSpaceId, household, isOnline, persistCloudHousehold]);

  const [dockHidden, setDockHidden] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const y = window.scrollY;
        const scrollable =
          document.documentElement.scrollHeight - window.innerHeight > 240;
        if (!scrollable || y < 80) {
          setDockHidden(false);
          lastY = y;
        } else if (y - lastY > 10) {
          setDockHidden(true);
          lastY = y;
        } else if (lastY - y > 10) {
          setDockHidden(false);
          lastY = y;
        }
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navigate = (tab: Tab) => {
    haptic();
    setDockHidden(false);
    if (tab === activeTab) {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    const apply = () => {
      setActiveTab(tab);
      window.scrollTo(0, 0);
    };
    const doc = document as Document & {
      startViewTransition?: (update: () => void) => unknown;
    };
    if (doc.startViewTransition && !prefersReducedMotion()) {
      doc.startViewTransition(() => {
        flushSync(apply);
      });
    } else {
      apply();
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
        <div className="card state-card" role="status" aria-live="polite">
          <h2>{isLoading ? 'Loading your household…' : 'Storage unavailable'}</h2>
          {isLoading && (
            <div className="skeleton-stack" aria-hidden="true">
              <div className="skeleton-item skeleton-hero" />
              <div className="skeleton-item skeleton-row" />
              <div className="skeleton-item skeleton-row" />
            </div>
          )}
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
  const metadataFullName = session.user.user_metadata.full_name;
  const profileName = typeof metadataFullName === 'string' && metadataFullName.trim()
    ? metadataFullName.trim()
    : 'User';
  const userName = profileName.split(/\s+/)[0] || 'User';
  const hour = now.getHours();
  let timeGreeting = 'Good evening';
  if (hour < 12) {
    timeGreeting = 'Good morning';
  } else if (hour < 18) {
    timeGreeting = 'Good afternoon';
  }
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
  const currentMonthExpenses = household.expenses.filter((expense) =>
    expense.date.startsWith(currentMonth),
  );
  const currentMonthSpendingCents = currentMonthExpenses.reduce(
    (sum, expense) => sum + expense.amountCents,
    0,
  );
  const allTimeSpendingCents = calculateTotalSpending(household);
  const reportSummaries = buildWeeklyAndMonthlySummaries(household.expenses);
  const monthCategoryTotals = new Map<string, number>();
  for (const expense of currentMonthExpenses) {
    monthCategoryTotals.set(
      expense.category,
      (monthCategoryTotals.get(expense.category) ?? 0) + expense.amountCents,
    );
  }
  const snapshotTransfers = snapshot?.transfers ?? [];
  const memberBalances = calculateBalances(household);
  const suggestedTransfers = suggestRepayments(memberBalances);
  const hasMonthlyBudget = (household.monthlyBudgetCents ?? 0) > 0;
  const monthlyBudgetCents = household.monthlyBudgetCents ?? 0;
  const remainingWalletCents = monthlyBudgetCents - currentMonthSpendingCents;
  const budgetSpentPercent = hasMonthlyBudget
    ? Math.min((currentMonthSpendingCents / monthlyBudgetCents) * 100, 100)
    : 0;
  const heroCents = hasMonthlyBudget ? remainingWalletCents : totalSpendingCents;
  const budgetState: 'ok' | 'near' | 'over' = !hasMonthlyBudget
    ? 'ok'
    : remainingWalletCents < 0
      ? 'over'
      : budgetSpentPercent >= 80
        ? 'near'
        : 'ok';
  const budgetStateLabel = { ok: 'On track', near: 'Nearing limit', over: 'Over budget' }[budgetState];

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

  const categoryCounts = new Map<string, number>();
  for (const exp of filteredExpenses) {
    categoryCounts.set(exp.category, (categoryCounts.get(exp.category) ?? 0) + 1);
  }
  const periodOptions = ['all', 'month', 'week'] as const;
  const periodIndex = periodOptions.indexOf(periodFilter);

  const getMemberName = (id: string) =>
    household.members.find((m) => m.id === id)?.name ?? 'Unknown';
  const hasCloudRoom = Boolean(
    isCloudConfigured() && household.syncRoomCode && household.syncPinHash,
  );
  const isSyncPending = household.pendingSync || !isOnline;
  const isSyncLive = hasCloudRoom && (
    !isSyncPending || liveSyncRoomCode === household.syncRoomCode
  );
  const syncState: 'local' | 'live' | 'pending' = !hasCloudRoom
    ? 'local'
    : isSyncLive
      ? 'live'
      : 'pending';
  const syncShortLabel = { local: 'Local', live: 'Live', pending: 'Pending' }[syncState];
  const syncStatusLabel = !hasCloudRoom
    ? 'Local only'
    : isSyncLive
      ? 'Live sync'
      : 'Offline or sync pending';

  return (
    <div className="app-shell" data-accent={household.themeAccent ?? 'cyan'}>
      {/* Top profile pill header */}
      <header className="top-pill-bar" data-accent={household.themeAccent ?? 'cyan'}>
        <button
          type="button"
          className="header-space-trigger"
          aria-expanded={spacesOpen}
          aria-haspopup="dialog"
          onClick={() => setSpacesOpen((open) => !open)}
        >
          <span className="profile-cluster">
            <span className="avatar-circle" aria-hidden="true">
              {household.name.charAt(0).toUpperCase()}
            </span>
            <span className="profile-title">{household.name}</span>
            <span className="profile-dropdown" aria-hidden="true"><IconChevron /></span>
          </span>
        </button>
        <div className="pill-badges">
          <span className="icon-chip">{household.currency}</span>
          <button
            type="button"
            className={`sync-chip sync-${syncState}`}
            onClick={() => navigate('settings')}
            aria-label={syncStatusLabel}
            title={syncStatusLabel}
          >
            <span className="sync-dot" aria-hidden="true" />
            <span className="sync-text">{syncShortLabel}</span>
          </button>
        </div>
        <span className="sr-only" role="status" aria-live="polite">{syncStatusLabel}</span>
      </header>

      <main className="main-content">
        {spacesOpen && createPortal(
          <div className="spaces-modal-backdrop" data-accent={household.themeAccent ?? 'cyan'} onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSpaces();
          }}>
            <section className="spaces-modal" role="dialog" aria-modal="true" aria-labelledby="spaces-title">
              <span className="sheet-handle" aria-hidden="true" />
              <div className="row-between">
                <h2 id="spaces-title">Your Spaces</h2>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={closeSpaces}
                  aria-label="Close Spaces"
                ><IconClose /></button>
              </div>
              <div className="space-list">
                {spaces.map((space) => (
                  <div className="space-row" key={space.id}>
                    <button
                      type="button"
                      className={`space-select ${space.id === activeSpaceId ? 'selected' : ''}`}
                      data-accent={space.accent}
                      aria-current={space.id === activeSpaceId ? 'true' : undefined}
                      onClick={() => void switchSpace(space.id)}
                    >
                      <span className={`space-color ${space.accent}`} />
                      <span>{space.name}</span>
                    </button>
                  </div>
                ))}
              </div>
              {creatingSpace ? (
                <form
                  className="create-space-form"
                  onSubmit={(event) => void createSpace(event)}
                  noValidate
                >
                  <h3>Create a new Space</h3>
                  <div className="form-group">
                    <label htmlFor="new-space-name">Space Name</label>
                    <input
                      id="new-space-name"
                      type="text"
                      maxLength={80}
                      autoComplete="organization"
                      value={newSpaceName}
                      onChange={(event) => {
                        setNewSpaceName(event.target.value);
                        setCreateSpaceError('');
                      }}
                      placeholder="e.g., Nugegoda Flat"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="new-space-nickname">Your Nickname</label>
                    <input
                      id="new-space-nickname"
                      type="text"
                      maxLength={80}
                      autoComplete="name"
                      value={newSpaceNickname}
                      onChange={(event) => {
                        setNewSpaceNickname(event.target.value);
                        setCreateSpaceError('');
                      }}
                      placeholder="e.g., Manuja"
                      required
                    />
                  </div>
                  {createSpaceError && (
                    <p className="amount-neg" role="alert">{createSpaceError}</p>
                  )}
                  <div className="create-space-actions">
                    <button type="submit" className="primary" disabled={createSpaceBusy}>
                      {createSpaceBusy ? 'Creating…' : 'Create Space'}
                    </button>
                    <button
                      type="button"
                      disabled={createSpaceBusy}
                      onClick={() => {
                        setCreatingSpace(false);
                        setCreateSpaceError('');
                        setNewSpaceName('');
                        setNewSpaceNickname('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="primary create-space-trigger"
                  onClick={() => {
                    setCreateSpaceError('');
                    setCreatingSpace(true);
                  }}
                >
                  + Create New Space
                </button>
              )}
              <button
                type="button"
                className="space-manage-sync"
                onClick={() => {
                  closeSpaces();
                  navigate('settings');
                }}
              >
                Manage Live Sync
              </button>
              {!creatingSpace && (
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
              )}
            </section>
          </div>,
          document.body,
        )}
        {joinPrompt && createPortal(
          <div className="spaces-modal-backdrop" data-accent={household.themeAccent ?? 'cyan'} onMouseDown={(event) => {
            if (event.target === event.currentTarget && !joinBusy) setJoinPrompt(null);
          }}>
            <section
              className="spaces-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="join-room-title"
            >
              <span className="sheet-handle" aria-hidden="true" />
              <div className="row-between">
                <h2 id="join-room-title">Join Shared Household Room</h2>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={joinBusy}
                  onClick={() => setJoinPrompt(null)}
                  aria-label="Close join dialog"
                ><IconClose /></button>
              </div>
              <p className="tx-sub">Join this room to collaborate on its shared expense ledger.</p>
              <div className="form-group">
                <label htmlFor="url-join-room-code">Room Code</label>
                <input
                  id="url-join-room-code"
                  type="text"
                  autoCapitalize="characters"
                  value={joinPrompt.roomCode}
                  onChange={(event) => setJoinPrompt({
                    ...joinPrompt,
                    roomCode: event.target.value.toUpperCase(),
                  })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="url-join-room-pin">4-digit PIN</label>
                <input
                  id="url-join-room-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={4}
                  value={joinPrompt.pin}
                  onChange={(event) => setJoinPrompt({
                    ...joinPrompt,
                    pin: event.target.value.replace(/\D/g, '').slice(0, 4),
                  })}
                />
              </div>
              {joinError && <p className="amount-neg" role="alert">{joinError}</p>}
              <div className="export-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={joinBusy || !isCloudConfigured()}
                  onClick={() => void confirmJoinRoom()}
                >
                  {joinBusy ? 'Joining…' : 'Join & Save as a Space'}
                </button>
                <button
                  type="button"
                  disabled={joinBusy}
                  onClick={() => setJoinPrompt(null)}
                >
                  Cancel
                </button>
              </div>
              {!isCloudConfigured() && (
                <p className="tx-sub">Cloud sync is not configured in this installation.</p>
              )}
            </section>
          </div>,
          document.body,
        )}
        {onboardingHousehold && createPortal(
          <OnboardingModal
            householdName={onboardingHousehold.name}
            initialName={onboardingIdentity?.name ?? ''}
            initialAvatar={onboardingIdentity?.avatar ?? ''}
            isSaving={onboardingBusy}
            error={onboardingError}
            onJoin={finishOnboarding}
            onCancel={() => {
              if (onboardingBusy) return;
              setOnboardingHousehold(null);
              setOnboardingIdentity(null);
            }}
          />,
          document.body,
        )}
        {needRefresh && (
          <div className="update-prompt" role="status" aria-live="polite">
            <p>
              A new version of WallyPad is available — Save or cancel any open
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
        <div key={activeTab} className={VIEW_CLASS}>
        {!snapshot && activeTab === 'overview' && (
          <section className="home">
            <div className="welcome-greeting">
              <h2>
                <span className="greet-line">{timeGreeting},</span>
                <span className="greet-name">{userName}.</span>
              </h2>
            </div>

            <div className="filter-pill-bar">
              <div
                className="segmented period-filter"
                role="group"
                aria-label="Spending period"
                style={{ '--n': 3, '--i': periodIndex } as CSSProperties}
              >
                <span className="seg-thumb" aria-hidden="true" />
                {periodOptions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`seg-btn ${periodFilter === value ? 'active' : ''}`}
                    aria-pressed={periodFilter === value}
                    onClick={() => setPeriodFilter(value)}
                  >{value.charAt(0).toUpperCase() + value.slice(1)}</button>
                ))}
              </div>
              <button type="button" className="report-button" onClick={() => {
                try {
                  exportPdfReport(household);
                } catch (error) {
                  setStorageError(getErrorMessage(error));
                }
              }}><IconDoc /> PDF</button>
            </div>

            <section className="hero-card" aria-label="Spending summary">
              <div className="hero-label">
                <span>{hasMonthlyBudget
                  ? 'Remaining monthly wallet'
                  : periodFilter === 'all'
                    ? 'Total household spending'
                    : periodFilter === 'month'
                      ? 'This month'
                      : 'This week'}</span>
                <span className="pill">
                  {filteredExpenses.length} {filteredExpenses.length === 1 ? 'bill' : 'bills'}
                </span>
              </div>
              <div className="hero-amount money">
                <AnimatedMoney cents={heroCents} />
              </div>
              {hasMonthlyBudget ? (
                <div className="hero-budget">
                  <div
                    className="hero-budget-track"
                    role="progressbar"
                    aria-label="Monthly household budget spent"
                    aria-valuemin={0}
                    aria-valuemax={monthlyBudgetCents}
                    aria-valuenow={Math.min(currentMonthSpendingCents, monthlyBudgetCents)}
                  >
                    <div
                      className={`hero-budget-fill ${budgetState}`}
                      style={{ transform: `scaleX(${budgetSpentPercent / 100})` }}
                    />
                  </div>
                  <p className="hero-sub">
                    <span className={`budget-flag ${budgetState}`}>
                      <span aria-hidden="true">{budgetState === 'ok' ? '✓' : budgetState === 'near' ? '!' : '✕'}</span>{' '}
                      {budgetStateLabel}
                    </span>
                    Spent {formatMoney(currentMonthSpendingCents)} of {formatMoney(monthlyBudgetCents)} limit
                  </p>
                </div>
              ) : (
                <p className="hero-sub">
                  {suggestedTransfers.length === 0
                    ? 'All housemate balances are settled'
                    : `${suggestedTransfers.length} suggested transfer(s) to settle up`}
                </p>
              )}
              <div className="hero-actions">
                <button
                  type="button"
                  className="hero-add"
                  aria-label="Add expense"
                  onClick={() => navigate('expenses')}
                ><IconPlus /></button>
                <button
                  type="button"
                  className="hero-settle"
                  onClick={() => navigate('repayments')}
                >
                  <span>Settle up</span>
                  <span className="hero-settle-icon" aria-hidden="true"><IconArrow /></span>
                </button>
              </div>
            </section>

            <div className="split-summary-bar">
              <div className="summary-metric">
                <span className="metric-label">
                  <span className="arrow-up" aria-hidden="true">↑</span> Total settled
                </span>
                <span className="metric-value money">{formatMoney(totalRepaidCents)}</span>
              </div>
              <div className="summary-divider" role="separator" aria-hidden="true" />
              <div className="summary-metric summary-metric-end">
                <span className="metric-label">
                  <span className="arrow-down" aria-hidden="true">↓</span> Unsettled
                </span>
                <span className="metric-value money">{formatMoney(totalUnsettledCents)}</span>
              </div>
            </div>

            {sortedCategories.length > 0 && (
              <>
                <div className="section-head">
                  <h2>Spending by category</h2>
                </div>
                <div className="block-stack">
                  {sortedCategories.map(([cat, cents], idx) => {
                    const cap = household.categoryBudgetsCents?.[cat];
                    const hasCap = cap !== undefined && cap > 0;
                    const percentage = hasCap
                      ? Math.round(((monthCategoryTotals.get(cat) ?? 0) / cap) * 100)
                      : 0;
                    const capState = percentage >= 100 ? 'over' : percentage >= 80 ? 'near' : 'ok';
                    const billCount = categoryCounts.get(cat) ?? 0;
                    const share = totalSpendingCents > 0
                      ? Math.round((cents / totalSpendingCents) * 100)
                      : 0;
                    return (
                      <article
                        key={cat}
                        className="category-card"
                        data-block={categoryBlock(cat)}
                        style={{ '--i': Math.min(idx, 7), zIndex: idx + 1 } as CSSProperties}
                      >
                        <div className="tag-row">
                          <span className="pill">{billCount} {billCount === 1 ? 'bill' : 'bills'}</span>
                          <span className="pill">{share}% of spend</span>
                        </div>
                        <h3 className="cat-name">{cat}</h3>
                        <div className="cat-amount money">{formatMoney(cents)}</div>
                        {hasCap && (
                          <div className="budget-meter">
                            <div className="budget-meter-head">
                              <span>{percentage}% of monthly cap</span>
                              {capState !== 'ok' && (
                                <span className={`budget-flag ${capState}`}>
                                  <span aria-hidden="true">{capState === 'over' ? '✕' : '!'}</span>{' '}
                                  {capState === 'over' ? 'Over cap' : 'Near cap'}
                                </span>
                              )}
                            </div>
                            <span className={`budget-track ${capState === 'ok' ? '' : capState}`}>
                              <span style={{ transform: `scaleX(${Math.min(percentage, 100) / 100})` }} />
                            </span>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </>
            )}

            <div className="section-head">
              <h2>Recent bills</h2>
              <button type="button" className="link-btn" onClick={() => navigate('expenses')}>
                See all ›
              </button>
            </div>
            {household.expenses.length === 0 ? (
              <div className="empty-state">No expenses recorded yet.</div>
            ) : (
              <div className="tx-list">
                {household.expenses.slice(0, 3).map((exp, idx) => (
                  <div
                    key={exp.id}
                    className="tx-row"
                    data-block={categoryBlock(exp.category)}
                    style={{ '--i': idx } as CSSProperties}
                  >
                    <div className="tx-left">
                      <div className="tx-avatar" aria-hidden="true">
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
                      <div className="tx-amount money">{formatMoney(exp.amountCents)}</div>
                      <div className="tx-sub">{exp.category}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <details className="report-preview">
              <summary>Weekly &amp; monthly breakdown</summary>
              <h3>Recent weeks</h3>
              {reportSummaries.weekly.slice(0, 4).map((row) => (
                <div className="row-between report-row" key={row.period}>
                  <span>{row.period}<small>{row.billCount} bills · {row.topCategory}</small></span>
                  <strong className="money">{formatMoney(row.totalCents)}</strong>
                </div>
              ))}
              <h3>Recent months</h3>
              {reportSummaries.monthly.slice(0, 3).map((row) => (
                <div className="row-between report-row" key={row.period}>
                  <span>{row.period}<small>{row.billCount} bills</small></span>
                  <strong className="money">{formatMoney(row.totalCents)}</strong>
                </div>
              ))}
            </details>

            <section className="dark-sheet" aria-label="Balances and settlements">
              <div className="section-head">
                <h2>Housemate balances</h2>
                <button type="button" className="link-btn" onClick={() => navigate('settings')}>
                  Manage ›
                </button>
              </div>
              {!hasMembers ? (
                <div className="empty-state">
                  <p>No housemates added yet.</p>
                  <button type="button" className="primary" onClick={() => navigate('settings')}>
                    + Add housemates
                  </button>
                </div>
              ) : (
                <div className="accounts-grid">
                  {memberBalances.map((b, idx) => {
                    const statusClass =
                      b.balanceCents > 0 ? 'pos' : b.balanceCents < 0 ? 'neg' : 'neutral';
                    const pctOfTotal = allTimeSpendingCents > 0
                      ? Math.round((b.paidCents / allTimeSpendingCents) * 100)
                      : 0;
                    return (
                      <div
                        key={b.memberId}
                        className="account-card"
                        style={{ '--i': Math.min(idx, 7) } as CSSProperties}
                      >
                        <div className={`account-icon ${statusClass}`} aria-hidden="true">
                          {b.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="account-name">{b.name}</div>
                        <div
                          className={`account-balance money ${
                            b.balanceCents > 0 ? 'amount-pos' : b.balanceCents < 0 ? 'amount-neg' : ''
                          }`}
                        >
                          {b.balanceCents > 0
                            ? `+${formatMoney(b.balanceCents)}`
                            : formatMoney(b.balanceCents)}
                        </div>
                        <div className="account-meta">Paid {formatMoney(b.paidCents)}</div>
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{ transform: `scaleX(${Math.min(pctOfTotal, 100) / 100})` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="section-head">
                <h2>Suggested settlements</h2>
                <button type="button" className="link-btn" onClick={() => navigate('repayments')}>
                  View all ›
                </button>
              </div>
              {suggestedTransfers.length === 0 ? (
                <div className="empty-state">
                  All settled up! Every housemate is at LKR 0.00.
                </div>
              ) : (
                <div className="tx-list">
                  {suggestedTransfers.map((t, idx) => (
                    <div
                      key={`${t.fromId}-${t.toId}`}
                      className="tx-row"
                      style={{ '--i': Math.min(idx, 7) } as CSSProperties}
                    >
                      <div className="tx-left">
                        <div className="tx-avatar tx-avatar-neg" aria-hidden="true">↗</div>
                        <div className="tx-info">
                          <p className="tx-title">{t.fromName} → {t.toName}</p>
                          <div className="tx-sub">Suggested settlement</div>
                        </div>
                      </div>
                      <div className="tx-right">
                        <div className="tx-amount money amount-pos">{formatMoney(t.amountCents)}</div>
                        <div className="tx-sub">Pending</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </section>
        )}

        {!snapshot && activeTab === 'expenses' && (
          <ExpenseManager
            key={activeSpaceId}
            household={household}
            onUpdateHousehold={commitHousehold}
            isSaving={isSaving}
            onGoToSettings={() => navigate('settings')}
          />
        )}

        {!snapshot && activeTab === 'needs' && (
          <NeedsLedger
            key={activeSpaceId}
            household={household}
            onUpdateHousehold={commitHousehold}
            isSaving={isSaving}
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
            profileName={profileName}
            profileEmail={session.user.email ?? ''}
            theme={theme}
            setTheme={setTheme}
            onSignOut={onSignOut}
            onUpdateHousehold={commitHousehold}
            onLoadDemo={() => commitHousehold(DEMO_HOUSEHOLD)}
            onResetEmpty={() => commitHousehold(createEmptyHousehold())}
            onJoinHousehold={addJoinedHousehold}
            onSyncNow={syncNow}
            isSaving={isSaving}
          />
        )}
        </div>
      </main>

      {/* Floating bottom dock */}
      {!snapshot && (() => {
        const dockIndex = { overview: 0, expenses: 1, repayments: -1, needs: 3, settings: 4 }[activeTab];
        return (
          <div className={`bottom-dock-wrap ${dockHidden ? 'is-hidden' : ''}`}>
            <nav
              className="bottom-dock"
              aria-label="Primary navigation"
              style={{ '--i': Math.max(dockIndex, 0) } as CSSProperties}
            >
              <span
                className={`dock-indicator ${dockIndex < 0 ? 'none' : ''}`}
                aria-hidden="true"
              />
              <button
                type="button"
                className="dock-item"
                aria-current={activeTab === 'overview' ? 'page' : undefined}
                onClick={() => navigate('overview')}
              >
                <span className="dock-icon"><IconHome /></span>
                <span>Home</span>
              </button>
              <button
                type="button"
                className="dock-item"
                aria-current={activeTab === 'expenses' ? 'page' : undefined}
                onClick={() => navigate('expenses')}
              >
                <span className="dock-icon"><IconBills /></span>
                <span>Bills</span>
              </button>
              <button
                type="button"
                className="dock-fab center-add-btn"
                aria-label="Add expense"
                onClick={() => navigate('expenses')}
              >
                <IconPlus />
              </button>
              <button
                type="button"
                className="dock-item"
                aria-current={activeTab === 'needs' ? 'page' : undefined}
                onClick={() => navigate('needs')}
              >
                <span className="dock-icon"><IconList /></span>
                <span>List</span>
              </button>
              <button
                type="button"
                className="dock-item"
                aria-current={activeTab === 'settings' ? 'page' : undefined}
                onClick={() => navigate('settings')}
              >
                <span className="dock-icon"><IconSettings /></span>
                <span>Settings</span>
              </button>
            </nav>
          </div>
        );
      })()}
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown storage error.';
}
