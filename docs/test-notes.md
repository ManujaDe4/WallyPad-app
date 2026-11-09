# RoomSplit Test Notes

**Test date:** 2026-11-08  
**Environment:** Windows; Node.js 24.14.0; npm 11.15.0; Vite 8.3.6;
TypeScript 6.0.3; Vitest 5.1.0

## Automated results

The initial suite passed all 11 tests on 2026-11-08. The Phase 2 suite passed
all 16 tests on 2026-11-09, including the original ledger and backup cases plus:

- Inline money-expression evaluation and personal-item supermarket splits.
- Weekly/monthly date grouping, category totals, and top-category summaries.
- URL-safe read-only settlement snapshot round-trip.
- AES-256-GCM encrypted backup round-trip and wrong-password rejection.

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
