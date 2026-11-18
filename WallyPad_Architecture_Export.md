# WallyPad Architecture Export

This export describes the implementation currently present in the source files inspected, including the app shell and the components it wires in. Where an example does not match the implementation, that difference is called out explicitly.

## 1. Tech Stack & Backend Infrastructure

### Application

- React with TypeScript; the main authenticated application and its view state are managed in `src/App.tsx`.
- Supabase JS is used for account authentication, optional shared-room sync, and database change subscriptions.
- IndexedDB, through the `idb` package, stores household data, Spaces, and app settings locally.
- WallyPad is configured as a PWA: the app uses `useRegisterSW` to prompt for an available service-worker update.
- Currency is fixed to `LKR`; monetary amounts in the data model are integer cents.

### Supabase authentication and shared rooms

- `AuthScreen` offers email/password account creation and sign-in. Sign-up sends the trimmed full name in Supabase user metadata and displays an email-confirmation prompt when Supabase returns no session.
- `App` registers `supabase.auth.onAuthStateChange`, checks the initial session with `getSession`, unsubscribes on cleanup, and calls `signOut` from its sign-out handler.
- The client is initialized lazily from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, falling back to `VITE_SUPABASE_ANON_KEY`. Without those values, cloud features report that cloud sync is not configured.
- Shared-room reads and writes use the RPCs `fetch_room_with_pin` and `upsert_room_with_pin`; the write passes the household payload and `deletedIds`. The code therefore relies on these configured server-side RPCs rather than directly selecting or mutating room rows.
- Room PINs must be four digits. `hashPin` computes SHA-256 over the normalized room code and trimmed PIN. Generated room codes use up to four letters from the household name (padded with `X`) followed by a random four-digit suffix.
- Supabase Realtime uses the Supabase client's channel (WebSocket-based) subscription to `postgres_changes` on `public.wallypad_rooms`, filtered by `room_code`; the channel name is `wallypad-room-${roomCode}`. The app consumes change payloads, merges remote data, and removes the channel on unsubscribe.
- `mergeHouseholds` merges members, expenses, and repayments by ID (local items take precedence), merges needs by ID using `updatedAt`, and filters IDs recorded as deleted. It carries deletion tombstones and the latest household `updatedAt`.
- Failed/offline pushes leave `pendingSync` true. The app tracks browser online/offline events and retries pending sync when possible; errors are logged or shown in the UI.
- The code uses the `wallypad_rooms` table for realtime change notifications and the named RPCs for data access. Its source does not define or document the SQL table schema or RPC implementation.

### IndexedDB local caching and Spaces

- The database is `wallypad-db`, version `2`, with three object stores:
  - `appState`: `Household` values; the current household is stored under `current`.
  - `spaces`: `Space` values keyed by Space ID.
  - `settings`: string values such as `activeSpaceId` and serialized `localIdentity`.
- The first open runs a one-time migration from the legacy `roomsplit-db`. Existing keys are copied only where the new store does not already have a value. If there is no legacy database, the migration-complete marker is still written.
- When a Spaces index is empty but a legacy current household exists, it is wrapped in a new Space. If Spaces exist but the active ID is absent or invalid, `loadSpacesIndex` selects the first Space and updates the active ID and current-household copy.
- `saveHousehold` writes the current household and, when there is a valid active Space, updates that Space's household and name in one read-write transaction. `setActiveSpaceId` changes the active ID and current-household copy.
- `deleteSpace` removes a Space and, if it was active, selects the first remaining Space; if none remain, it clears the active ID and current household. The app code inspected does not call `deleteSpace`, so this fallback exists in storage but is not exposed as a wired Space-deletion action in the current UI.
- The app theme is stored separately in `localStorage` as `wallypad_theme`; the legacy `roomsplit_theme` key is migrated and removed.

## 2. Core Data Models

These are exported as TypeScript `type` aliases in `src/types.ts` (not `interface` declarations):

```ts
export type Member = { id: string; name: string; avatar?: string };

export type Expense = {
  id: string;
  title: string;
  category: string;
  amountCents: number;
  paidById: string;
  date: string; // YYYY-MM-DD
  splitMode: 'equal' | 'custom';
  shares: Share[];
};

export type NeedItem = {
  id: string;
  name: string;
  isChecked: boolean;
  lastPriceCents: number;
  updatedAt?: string;
  lastPurchasedAt?: string;
};

export type Household = {
  id: string;
  name: string;
  currency: 'LKR';
  members: Member[];
  expenses: Expense[];
  repayments: Repayment[];
  needsLedger?: NeedItem[];
  updatedAt: string;
  adminId?: string;
  monthlyBudgetCents?: number;
  categoryBudgetsCents?: Record<string, number>;
  themeAccent?: SpaceAccent;
  syncRoomCode?: string;
  syncPinHash?: string;
  deletedIds?: string[];
  lastSyncedAt?: string;
  pendingSync?: boolean;
};
```

Supporting types used by these declarations:

```ts
export type Share = { memberId: string; amountCents: number };

export type Repayment = {
  id: string;
  fromId: string;
  toId: string;
  amountCents: number;
  date: string;
};

export type SpaceAccent = 'cyan' | 'emerald' | 'amber' | 'indigo';
```

## 3. Feature Inventory

- **Authentication gateway:** initial session lookup, auth-state listener, loading state, sign-in/sign-up modes, full-name metadata on sign-up, validation/errors, email-confirmation message, and sign-out.
- **Local startup and recovery:** loads the active household and Spaces from IndexedDB, uses the demo household if no saved household is found, surfaces storage errors, and offers retry. Household updates persist locally before the UI considers them saved.
- **Dynamic greeting and overview:** greets the signed-in user by first name from Supabase metadata, with a `User` fallback; greeting changes between morning, afternoon, and evening based on local time.
- **Spending dashboard:** filters overview spending by all time, current month, or current Monday-to-today week; shows the filtered total, bill count, recent bills, up to four category totals, and recent weekly/monthly breakdowns.
- **Monthly budget wallet:** when a positive household monthly budget exists, the hero amount becomes remaining monthly budget (`monthlyBudgetCents - currentMonthSpendingCents`) and includes a capped progress bar and spent/limit text. Without a positive budget, the hero shows spending for the selected period.
- **Category budgets:** Settings stores optional monthly caps for Groceries, Rent, Utilities, and Other; the overview shows category utilization and changes the meter styling at 80% and 100%.
- **Housemate balances and settlements:** the balance calculation adds expenses paid and subtracts each member's shares; repayments adjust the sender and receiver balances. Suggested transfers pair debtors and creditors, reducing the larger outstanding balances first. Equal splits distribute remainder cents deterministically across sorted member IDs using `amountCents % participantCount`. There is no separate “balance modulo math” in the implementation.
- **Expense ledger:** create, edit, and delete shared expenses; choose category, date, payer, participants, and equal or custom shares; preview equal shares; use quick-fill presets; enter arithmetic expressions for amounts; optionally allocate personal-item amounts before equally splitting a supermarket total; and search/filter transactions.
- **Needs Ledger:** add uniquely named recurring needs (up to 80 characters), mark an item bought after entering its price, uncheck it, or delete it. Checked items sort after unchecked items; monthly spend sums checked items whose `lastPurchasedAt` is in the current month. Item deletions are recorded as sync tombstones.
- **Needs-to-expense scope:** the Needs Ledger tracks recurring items and purchase prices. The inspected implementation does not convert cart/list items into an Expense automatically.
- **Repayments:** see suggested transfers, quick-fill a repayment from a suggestion, record a validated payment between a debtor and creditor within the current settlement limit, and delete repayment records.
- **Settlement sharing:** copy a WhatsApp settlement summary or copy a read-only snapshot URL; a snapshot route displays balances, suggested transfers, and total spend, and can be dismissed to return to the ledger. The UI describes a share badge/QR area, but the inspected code provides a static SVG badge and snapshot link rather than generating a QR code.
- **Household and member management:** edit household name and monthly budget (admin-gated), add/rename housemates, and delete eligible housemates only when they are not referenced by expenses or repayments. Currency is displayed as LKR and is not editable in this UI.
- **Settings and reports:** switch light/dark theme, create or join cloud rooms, manually sync or disconnect, copy an invite link, export PDF and CSV reports, and replace the ledger with a confirmed empty or demo preset (admin-gated).
- **Spaces:** create a Space with a household name and initial nickname, switch active Spaces, and choose cyan/emerald/amber/indigo accents. A `?join=...&pin=...` URL can open/auto-submit a room join prompt; joined users are matched to a local identity or asked to complete onboarding. The storage layer has deletion fallback behavior, but the inspected `App` does not expose a Space-delete control or call `deleteSpace`.
- **Live sync and offline status:** show local-only/live/pending status, subscribe to room updates, merge changes and deletion tombstones, mark local changes pending, and retry when connectivity returns.
- **PWA update prompt:** when a service-worker update is available, show Update Now and Dismiss actions.
- **Navigation:** five dock positions route to Home, Bills, Add Expense, List (Needs), and Settings. Repayments are accessible from Home and the repayment actions, but are not a distinct bottom-dock item.

## 4. Current CSS Architecture & Geometry

- **Design tokens:** light theme defaults use app background `#f4f7f9`, white surfaces, slate text, cyan accent `#06b6d4`, and success/danger colors. Dark theme overrides surfaces, text, accent, and related states under `[data-theme='dark']`.
- **Radius tokens:** `--radius-xl: 28px`, `--radius-lg: 20px`, `--radius-md: 14px`, and `--radius-pill: 999px`; the dock itself uses `26px`.
- **Hero geometry:** `.hero-card` uses `border-radius: var(--radius-xl)` (28px on all corners), a cyan-to-blue gradient, shadow, padding, and clipped decorative circles. It does **not** currently use 40px bottom-only radii.
- **Hero actions:** `.hero-actions` is a two-column grid; its two buttons use pill radii. The inspected stylesheet contains no bento-box action grid or “squircle” action-button structure.
- **Top profile header:** `.top-pill-bar` is a blurred, translucent surface with a fully rounded pill border radius. Its profile trigger, Space name, currency chip, and sync-status chip share the header.
- **Floating bottom dock:** `.bottom-dock-wrap` is fixed above the bottom safe-area inset and centered. `.bottom-dock` is a translucent, blurred, bordered surface with a 26px radius, shadow, safe-area-aware bottom padding, and five equal grid columns. The center add control is a 56px circular FAB. Main content reserves bottom padding for the dock.
- **Mobile-first shell:** `.app-shell` is capped at 480px wide; `.main-content` is capped at 600px, with the shell acting as the narrower overall constraint. Modals use fixed, full-screen backdrops and safe-area-aware padding.
- **Scrolling and overflow:** `html` and `body` hide horizontal overflow while retaining vertical `auto` scrolling; `body` uses `-webkit-overflow-scrolling: touch`. The app shell and main content also hide horizontal overflow. Horizontal category scrolling uses touch momentum scrolling, `scroll-snap-type: x mandatory`, and hidden scrollbars. Global rules hide scrollbars, and touch selection/highlight behavior is constrained (`user-select: none`, `touch-action: manipulation`), with text inputs and textareas made selectable.
- **Needs layout:** the add form is sticky near the top safe area; the list is a vertical stack of rounded cards with a circular checkbox, price, and delete control.
- **Responsive and accessibility details:** the stylesheet includes small-screen rules, safe-area insets, reduced-motion handling for the onboarding animation, and hidden scrollbar styling. Native inputs remain 16px to avoid mobile zoom behavior.
