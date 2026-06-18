# Effex Frontend — Assessment Report
## Backend Coverage × UI Gap Analysis

Generated: 2026-06-18

---

## Summary

| Category | Count |
|---|---|
| Backend endpoints never used by frontend | 9 |
| Frontend features using wrong/missing endpoints | 4 |
| UI layout / visual bugs | 10 |
| Missing feature pages (backend ready, no UI) | 3 |
| Data fields fetched but not rendered | 7 |

---

## Part 1 — Backend Endpoints vs Frontend Usage

### ✅ Fully Used

| Endpoint | Used In |
|---|---|
| `GET /balance` | Dashboard, dataService |
| `GET /ledger` | Dashboard, Ledger |
| `GET /stats/streak` | Dashboard, Focus, Marketplace, Achievements |
| `GET /stats/daily` | Focus, Achievements |
| `GET /credit` | Dashboard, Oaths |
| `GET /oaths` | Oaths, Dashboard |
| `POST /oaths` | Oaths |
| `POST /oaths/{id}/repay` | Oaths |
| `GET /marketplace/catalogue` | Marketplace |
| `GET /marketplace/my-passes` | Marketplace |
| `POST /marketplace/purchase` | Marketplace |
| `POST /marketplace/activate/{id}` | Marketplace |
| `PATCH /marketplace/end-early/{id}` | Marketplace |
| `DELETE /marketplace/cancel/{id}` | Marketplace |
| `GET /wellness/dashboard` | Wellness |
| `POST /wellness/sleep/start` | Wellness |
| `POST /wellness/sleep/wake` | Wellness |
| `POST /wellness/exercise/log` | Wellness |
| `GET /bosses` | Achievements |
| `GET /mercy` | Achievements |
| `POST /deductions` | Ledger modal |
| `POST /deductions/override` | Ledger modal |
| `GET /settings` | Settings |
| `PATCH /settings` | Settings |
| `GET /settings/suggestions` | Settings |
| `POST /settings/suggestions/{id}/apply` | Settings |
| `POST /settings/suggestions/{id}/dismiss` | Settings |
| `GET /sessions` | Focus |
| `GET /stream` | Root SSE watcher |
| `GET /health` | Settings connection test |

---

### ❌ Backend Endpoint Exists — Frontend Never Calls It

| Endpoint | What It Returns | Impact |
|---|---|---|
| `GET /usage/today` | Per-app distraction minutes, drain total, category breakdown | No distraction usage page at all — nav link goes to a 404 |
| `GET /deductions` | Full deduction audit trail (pending / approved / rejected with reasoning) | Users cannot see history of their self-penalties |
| `POST /bosses` | Creates a new boss fight | Boss fights can only be created via raw API; no UI form exists |
| `DELETE /bosses/{id}` | Abandons a boss fight | Same — no abandon button anywhere |
| `GET /wellness/sleep/history` | 30 completed sessions with `sleep_at_ms`, `wake_at_ms`, full timestamps | Dashboard uses aggregate instead; no per-session timeline possible |
| `GET /wellness/sleep/current` | `elapsed_hours` for the open sleep session | No live elapsed sleep timer — only shows start time |
| `GET /device` | Device heartbeat info | Called by `getDevice()` in settings but **endpoint does not exist in any backend router** — will always 404 |
| `GET /stream` (partial) | SSE events: `earn`, `upi`, `boss_beaten`, `pass_expired`, `drain` | Only `drain` type is acted on; `earn`/`upi`/`boss_beaten`/`pass_expired` fire with no UI reaction |
| `GET /bosses/{id}` (if exists) | Individual boss detail | Not confirmed — boss detail view missing |

---

### ⚠️ Endpoint Called But Response Partially Ignored

| Endpoint | Field Dropped | Impact |
|---|---|---|
| `POST /marketplace/purchase` | `guilt_tax` in response | Post-purchase toast never shows guilt tax charged |
| `POST /oaths/{id}/repay` | `credit_score_delta`, `resolved_status` | Toast says "boost incoming" but never shows actual delta |
| `POST /wellness/exercise/log` | `rate_per_10_min` | User never sees their current earn rate |
| `GET /wellness/dashboard` | `step_history` array (30 days) | Step data is fetched but nothing renders it |
| `GET /marketplace/catalogue` | `valid_on_weekends_only` | Not in server response shape — frontend cannot show "weekends only" label |

---

## Part 2 — Frontend Pages vs What They Should Show

### `/` — Dashboard

**Showing:** Balance, streak, credit ring, active oath count, 30-day ledger chart, monthly spend bar  
**Missing:**
- Daily study progress ring (target vs actual minutes) — `/stats/daily` is available
- Today's step count + step income — returned by `/wellness/dashboard`
- SSE handlers for `earn`, `upi`, `boss_beaten` events — balance only updates on `drain`
- Monthly discretionary budget reads hardcoded `3000` instead of `settings.monthlyDiscretionaryBudget`
- Active pass banner should auto-refresh from `/marketplace/my-passes` on SSE `pass_expired`

---

### `/ledger` — Ledger

**Showing:** Transaction list with search, category filter, self-penalty modal  
**Missing:**
- Deduction history panel (`GET /deductions`) — pending/rejected deductions with reasoning never shown
- Server-side pagination — fetches all entries at once, slow on large datasets
- Category filter missing: `NOTIFICATION_UPI`, `OATH_LOAN`, `OATH_INTEREST`, `BOSS_REWARD`, `SURGE`, `MERCY_SPEND`
- `override_tax` displayed without ₹ formatting (inconsistent with rest of UI)

---

### `/marketplace` — Marketplace

**Showing:** Pass catalogue, eligibility, my passes, buy/activate/cancel/end-early  
**Missing:**
- `CONSUMED` pass status has no distinct visual badge (shows same as `EXPIRED`)
- `loot_bonus_minutes` from boss fight rewards not clearly called out on activated pass card
- Weekend-only indicator missing (field not in API response — backend fix needed)
- Guilt tax not confirmed in post-purchase toast

---

### `/wellness` — Wellness

**Showing:** Sleep toggle, sleep history (30 days), exercise log, exercise history  
**Missing:**
- **Step history entirely absent** — 30-day step data is in the API response but never rendered
- No live elapsed sleep timer (only shows start time, not "sleeping for X hours")
- Exercise history hardcapped at 10 entries with no load-more
- `GET /wellness/sleep/current` for accurate live state never called

---

### `/oaths` — Oaths

**Showing:** Active oaths, repay button, credit ring, history  
**Missing:**
- Repay response delta (`credit_score_delta`) never shown in toast
- `REPAID_ON_TIME` → `REPAID_ONTIME` typo in `StatusPill` map — on-time repayments get no styling
- Unhandled rejection on repay when balance < debt — no error shown to user
- History cards show minimal info (no loan amount, no debt paid, no credit delta)

---

### `/focus` — Focus Sessions

**Showing:** NFC session list, study heatmap calendar, streak multiplier  
**Missing:**
- **Boss fight creation UI** — `POST /bosses` exists but there is no form anywhere
- No distraction context (`GET /usage/today`) — would show competing apps vs focus time
- No all-time or monthly hour totals

---

### `/achievements` — Achievements

**Showing:** Boss fight cards (read-only), mercy tokens, streak grid, AI challenges  
**Missing:**
- AI Challenges are **entirely fake** — `getAIChallenges()` calls `/bosses` in live mode (wrong endpoint). No `/ai_challenges` backend router exists. Cards render malformed data.
- Boss fight `status` (beaten/failed/active) not shown; no beaten/failed history
- Mercy token "Last used: never" is hardcoded — backend does not expose this field
- Mercy token count hardcapped at 3 circles — if backend awards more, extras silently disappear

---

### `/settings` — Settings

**Showing:** Rate configuration, AI rate advisor, distraction rules table, device info  
**Missing:**
- **`GET /device` does not exist** — device info card will always fail/show empty in production
- Distraction rules table is **mock-only** — loads from `mockUsageReport`, not `GET /usage/today`. Changes are local state only, never saved to backend
- `apiBaseUrl` setting saved in localStorage but `apiFetch` always reads from `VITE_API_BASE_URL` env var at build time — changing URL in UI has zero effect at runtime

---

### `/distraction` — MISSING PAGE

Nav link exists in `SidebarNav.tsx`. Route file `routes/distraction.tsx` **does not exist** → 404 on click.  
Backend `GET /usage/today` returns everything needed: per-app minutes, drain amounts, surge costs, category breakdown.

---

## Part 3 — UI / Layout Bugs

### 1. Bottom nav not floating on mobile (reported)
**File:** `src/components/layout/PageLayout.tsx`  
The bottom nav is `fixed bottom-3 inset-x-3` which should float. However `PageLayout` wraps content in `pb-28` (112px padding-bottom). This is too much — the nav is ~56px tall + 12px gap = 68px clearance needed. 112px creates a large dead zone at the bottom of every mobile page.

### 2. `/distraction` is a dead nav link
**File:** `src/components/layout/SidebarNav.tsx`  
Nav entry points to `/distraction`. No `routes/distraction.tsx` exists → 404.

### 3. `REPAID_ON_TIME` / `REPAID_ONTIME` casing mismatch
**File:** `src/routes/oaths.tsx`, StatusPill map  
Backend serializes `REPAID_ON_TIME`. Frontend map key is `REPAID_ONTIME`. On-time repayment pills get no background/color styling.

### 4. `monthBudget` hardcoded to 3000
**File:** `src/routes/index.tsx` line ~79  
Should read from `settings.monthlyDiscretionaryBudget`. Hardcoded value makes the budget progress bar meaningless.

### 5. Sleep overlay blurs sidebar
**File:** `src/components/wellness/SleepOverlay.tsx`  
`filter: blur(8px)` applied to the full layout container including sidebar. Sidebar navigation becomes illegible while sleeping. Only the main content area should blur.

### 6. SSE `earn`/`upi`/`boss_beaten`/`pass_expired` events silently dropped
**File:** `src/lib/hooks/useEconomyStream.ts`  
Only `drain` event updates UI. All other server-sent events are received but produce no toast, no balance refresh, no badge update.

### 7. `getDevice()` calls non-existent endpoint
**File:** `src/lib/dataService.ts`  
`GET /device` — no such route in backend. Settings page device card will always fail silently.

### 8. Repay oath — unhandled promise rejection
**File:** `src/routes/oaths.tsx`, `onRepay` handler  
`await repayOath(id)` has no try/catch. On HTTP 400 (insufficient balance), the error propagates unhandled — no user-facing message shown.

### 9. AI Challenges misrouted to `/bosses` in live mode
**File:** `src/lib/dataService.ts`, `getAIChallenges()`  
Non-mock code calls `GET /bosses` and returns boss data as challenge data. Challenge card expects `metric_type`, `metric_target`, `current_value` fields that don't exist on boss objects. Results in empty/broken challenge cards in production.

### 10. Distraction rules table reads mock data
**File:** `src/routes/settings.tsx`  
`AppRulesTable` initialises from `mockUsageReport.apps` regardless of mock mode flag. Live distraction rates from `GET /usage/today` are never used to populate the table.

### 11. `apiBaseUrl` UI setting has no runtime effect
**File:** `src/lib/dataService.ts`  
`BASE` is set from `import.meta.env.VITE_API_BASE_URL` at module load. Runtime changes in Settings UI write to localStorage and PATCH backend but `apiFetch` never re-reads the value.

---

## Part 4 — Mock Data (To Remove)

`src/lib/mockData.ts` and `USE_MOCK` flag in `dataService.ts` are the source of several of the above bugs (challenges misrouting, distraction table, device info). Removing mock mode entirely will:
- Force all data through real API calls
- Remove the `getAIChallenges()` → `/bosses` misroute (function should be removed or properly implemented)
- Fix the distraction rules table initialisation
- Simplify `dataService.ts` significantly

---

## Recommended Fix Priority

### P0 — Broken in production right now
1. `/distraction` dead nav link → create the page or remove the nav entry
2. `GET /device` endpoint missing → remove device card or add the backend endpoint
3. `getAIChallenges()` → `/bosses` misroute → remove challenges section or implement backend
4. Repay oath unhandled rejection → wrap in try/catch
5. Remove all mock data / `USE_MOCK` flag

### P1 — Data fetched but silently dropped
6. Render step history on Wellness page
7. Show `credit_score_delta` in repay oath toast
8. Show `guilt_tax` in purchase toast
9. Fix `REPAID_ON_TIME` casing in StatusPill
10. Fix `monthBudget` hardcoded value → read from settings

### P2 — Missing features with backend ready
11. Create `/distraction` route using `GET /usage/today`
12. Add boss fight creation form (POST /bosses)
13. Add deduction history panel (GET /deductions)
14. Add live sleep elapsed timer (GET /wellness/sleep/current)
15. Handle all SSE event types (`earn`, `upi`, `boss_beaten`, `pass_expired`)

### P3 — Polish
16. Fix `pb-28` → `pb-20` in PageLayout for correct floating nav clearance
17. Sleep overlay — blur only main content, not sidebar
18. Add server-side pagination to ledger
19. Add missing ledger category filters
20. Add `CONSUMED` badge distinction in marketplace my-passes
