# RoomSplit Test Notes

**Test date:** 2026-11-08  
**Environment:** Windows; Node.js 24.14.0; npm 11.15.0; Vite 8.3.6;
TypeScript 6.0.3; Vitest 5.1.0

## Automated results

Vitest passed all 11 tests covering money parsing, equal and custom splits,
payer exclusion, the Page 8 balances and repayment suggestions, partial and
complete repayments, expense edits and deletions, and backup validation and
round-tripping.

Release checks:

- `npm run test` — passed
- `npm run lint` — passed
- `npm run build` — passed

## Hands-on release checklist

- [ ] Confirm the installed PWA manifest shows RoomSplit with both PNG icons.
- [ ] Install the app and confirm it launches in standalone display mode.
- [ ] Load the app once, go offline, and confirm the cached app shell opens.
- [ ] Publish a new version and confirm the update pill appears.
- [ ] Dismiss the update prompt and confirm the current app remains usable.
- [ ] Reopen the prompt, save or cancel any open form, then choose **Update Now**.
- [ ] Confirm the updated app reloads and saved household data remains available.
