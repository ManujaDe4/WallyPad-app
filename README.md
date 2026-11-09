# RoomSplit

An offline-capable shared-expense tracker for student housemates in Sri Lanka.
RoomSplit keeps the household ledger on the device, helps make shared costs
clear, and works without cloud accounts.

## Project Overview & Problem Statement

Housemates often need a simple way to track shared bills, agree how each bill
should be split, and see who needs to pay whom. RoomSplit is a mobile-first
Progressive Web App (PWA) designed for student households using Sri Lankan
rupees (LKR). Housemates can track bills, split costs equally or by custom
exact amounts, and settle debts without creating cloud accounts. Household
data is stored locally in the browser, so the app remains useful when offline
after it has been loaded.

## Live Demo & Screenshots

- **Cloudflare Pages demo:** [https://roomsplit-app.pages.dev/]
  *(deployment URL placeholder)*

Add current product screenshots at the paths below:

![RoomSplit desktop overview screenshot](docs/screenshots/desktop.png)

![RoomSplit mobile overview screenshot](docs/screenshots/mobile.png)

![RoomSplit three-member demo fixture showing household balances and suggested repayments](docs/screenshots/demo-fixture.png)

The demo fixture uses three housemates—Manuja, Nimal, and Kavindu—with shared
expenses totaling LKR 5,100.00.

## Key Features

- Create and manage a household profile and its members.
- Record household expenses and assign who paid.
- Split a bill equally or enter custom shares that must exactly match the
  expense total.
- Enter simple addition/subtraction expressions and optionally deduct
  housemates' personal items before equally splitting a supermarket bill.
- Calculate member balances from the ledger and suggest settlements using a
  greedy repayment-matching algorithm.
- Record repayments, review repayment history, and delete a recorded repayment
  to reverse its effect on balances.
- Keep multiple isolated local Spaces with selectable theme accents and
  optional monthly category budgets.
- Preview weekly/monthly spending, then print a detailed report to PDF or
  export the ledger as CSV.
- Copy a WhatsApp settlement summary or share a compact read-only settlement
  snapshot link.
- Persist household ledgers and Spaces in browser IndexedDB.
- Cache the app shell and static assets with a Service Worker for offline
  reloads, and prompt users when an app update is ready.
- Export and import JSON backups with schema, size, member-reference, date, and
  amount validation, with optional AES-256-GCM password encryption.

## Tech Stack

- React
- TypeScript
- Vite
- IndexedDB via [`idb`](https://github.com/jakearchibald/idb)
- [`vite-plugin-pwa`](https://github.com/vite-pwa/vite-plugin-pwa) and Workbox
- Vitest
- Cloudflare Pages

## Engineering Notes

### Integer-Cent Arithmetic

Money is parsed from decimal input once and stored as integer cents:
`LKR 125.50` becomes `12550`. Using integers for ledger arithmetic avoids
IEEE 754 floating-point rounding errors that can occur when decimal currency
values are repeatedly added or divided. Formatting converts the integer value
back to LKR for display.

### Deterministic Remainder Allocation

`splitEqual` calculates the base share with integer division and the remainder
with `amountCents % n`. It sorts participant IDs before assigning one extra
cent to each of the first remainder participants. The ordering is deterministic
and every share is an integer number of cents, so the shares always sum to the
exact expense total.

### Derived Balances

Balances are calculated from expense payments, expense shares, and recorded
repayments whenever they are needed. They are not stored as independently
mutable member fields. This keeps the ledger as the source of truth and means
editing an expense or removing a repayment recalculates balances without
separate balance updates becoming stale.

### Snapshot Persistence & Service Worker

Household ledgers and Space metadata are stored in the `spaces` and `settings`
object stores of the `roomsplit-db` IndexedDB database. The `appState` store is
kept as a compatibility snapshot for the active Space. The Service Worker is a
separate layer: Workbox precaches the built app shell and static assets,
including HTML, CSS, JavaScript, and icons, so an already-loaded app can reload
offline. The Service Worker cache does not replace or contain the household
ledger.

## Known V1 Limitations

- Spaces are local to one browser profile and site origin. There is no login,
  hosted ledger, or live multi-device cloud synchronization.
- Moving a Space between devices or different site origins requires manually
  exporting and importing its JSON backup.
- Local browser storage is not encrypted. Exported JSON backups contain
  personal expense data unless the optional encrypted-backup export is used;
  keep both kinds somewhere private.

## Local Development & Testing Commands

Use a current Node.js installation and npm:

```sh
npm install
npm run dev
npm run test
npm run lint
npm run build && npm run preview
```

For Cloudflare Pages, build with `npm run build` and publish the generated
`dist` directory.
