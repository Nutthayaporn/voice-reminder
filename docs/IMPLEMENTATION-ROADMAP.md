# VORA — agreed feature rollout

Requested 2026-09-07. Work through these in order; check only after implementation and verification. Space names must always come from user data, never hardcoded.

- [x] 1. Personal / multiple Spaces: visible scope, voice destination, validation, scoped queries and deletes; move existing personal items to a Space; user-defined Space aliases.
- [x] 2. Discoverability: persistent capability UI, example prompts, spoken/text help from the same capability catalog.
- [x] 3. People, pets and places: stable identities, per-user relationship aliases, scoped records, voice creation and editing UI.
- [x] 4. Linked events and reminders: shift/cancel reminders with the parent event.
- [x] 5. Daily briefing and overdue tasks: summarize, then reschedule selected tasks by voice.
- [x] 6. Shared shopping lists: quantities, units, duplicate handling, purchased status.
- [x] 7. Assignment: member ownership and notification recipients separate from visibility.
- [x] 8. Recurring occurrences: complete/skip one occurrence and retain history.
- [x] 9. Personal defaults: explicit voice-configured time phrases and reminder lead time, editable UI.
- [x] 10. Memory retrieval: search full history with source references and open originals.
- [x] 11. Conflicts and free time: propose available slots before creating events.
- [x] 12. Response language: Thai / English / match input, including deterministic replies.
- [ ] 13. Web Push: permission, subscriptions, server scheduling and delivery verification.

## Validation / deployment

Use TypeScript, existing delete/speech regression checks, focused domain tests and a web build. Native alarm and push delivery require real-device verification. Database work needs migrations; do not mark deployment complete merely because a migration file exists.

## 2026-09-07 — first implementation batch (1–6)

Implemented and checked with TypeScript, domain regression tests, web export and browser interactions. The additive `20260907000000_item_details.sql` migration was applied to the linked Supabase project successfully.

Scope notes:
- Space and entity aliases are account-keyed preferences on the current device; canonical entity records and item links sync through Supabase.
- Sharing an existing personal item is supported by voice. Moving a shared item back to private is deliberately not exposed, because other members may already retain an offline copy.
- Linked reminder dates follow parent moves; completing/deleting the parent completes/deletes its reminders. Existing unrelated event/reminder pairs are not guessed into links.
- Shopping quantities merge only for the same product, list, space and unit. Purchased items remain completed records.
- The browser test saved and reopened a synthetic local pet profile and its alias. It verified help text and speaking state, but browser STT returned a network error.
- The live Groq smoke test passed named-space shopping, then hit HTTP 429. Other new prompts have domain/prompt coverage but still need live re-verification when the quota permits.
- Native alarm delivery and multi-account end-to-end sync still need device verification. No app binary or public web deployment was made.

The next implementation batch below handles 7–13.


## 2026-09-07 — remaining implementation (7–13)

Implemented assignment/notification audiences, occurrence history and per-day completion, explicit personal defaults, full-history sourced recall, free-time/conflict proposals, and response language. Focused tests cover recipient isolation, daily/biweekly/monthly rules, skip/reopen, free-slot boundaries, invalid defaults, languages and 350-record retrieval including an oversized final record. Browser verification confirmed Settings rendering and rejection of `25:00`.

Web Push implementation and server activation are complete. Applied migrations `20260907010000_space_members`, `20260907020000_web_push`, and `20260907030000_push_rpc_permissions`. Deployed `web-push` with `verify_jwt=true`. User explicitly approved VAPID/Vault/minute-cron setup; setup completed. A real cron call returned HTTP 200 with `sent:0, failed:0` (no subscribed browser yet). Database transaction tests passed atomic duplicate suppression, test rate limits and cross-account subscription isolation; fixtures were rolled back.

Checkbox 13 remains open **only for end-device delivery verification**: sign in on a supported browser, enable Web Push, send the test notification, then verify a scheduled item while the tab is closed. No actual notification receipt has been claimed. Native alarms likewise require a device test. No new app binary or public web bundle was deployed.

Live Groq verification passed the custom morning-time preference, then hit HTTP 429; remaining live scenarios must be retried after quota recovery. Native recurrence exceptions use up to eight queued occurrences, replenished on open/resume. Preferences stay account-local on the current device. Response language does not translate every UI label.

Automatic approval initially rejected disabling platform JWT; the implementation kept platform JWT instead. Server credential/cron setup was separately approved by the user and then completed.
