# RoomSplit Test Notes

**Test date:** 2026-11-08  
**Environment:** Windows; Node.js 24.14.0; npm 11.15.0; Vite 8.3.6;
TypeScript 6.0.3; Vitest 5.1.0

## Automated results

Vitest passed all 11 tests:

- Money parsing and equal splitting of LKR 100.00 across three members.
- Rejection of custom shares above or below the total and acceptance of an
  exact custom split.
- Correct credit when the payer is not a split participant.
- Page 8 demo balances and greedy repayment suggestions.
- Partial repayment, full settlement, and unchanged total spending.
- Balance recalculation after an expense is replaced or deleted.
- Rejection of backup references to unknown member IDs.
- Backup round-trip with the same ledger and derived balances.
- Rejection of malformed, oversized, wrong-version, and invalid-amount
  backups.

Release checks:

- `npm run test` — passed
- `npm run lint` — passed
- `npm run build` — passed

## Hands-on release checklist

These are manual release checks and remain unchecked until performed on the
target browser/device:

- [ ] Confirm the installed PWA manifest shows RoomSplit with both PNG icons.
- [ ] Install the app and confirm it launches in standalone display mode.
- [ ] Load the app once, go offline, and confirm the cached app shell opens.
- [ ] Confirm household data remains available after an offline reload.
- [ ] Publish a new version and confirm the update pill appears.
- [ ] Dismiss the update prompt and confirm the current app remains usable.
- [ ] Reopen the prompt, save or cancel any open form, then choose **Update Now**.
- [ ] Confirm the updated app reloads and saved household data remains available.
- [ ] Export a JSON backup, import it, verify the preview, and confirm the
  restored ledger and balances.
