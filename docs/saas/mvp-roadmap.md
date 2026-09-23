# MVP Roadmap & Information Architecture

Phase 4.6 recommendations. Navigation **implementation** deferred to Phase 4.7.

---

## Domain priority

### MVP CORE

Forms the closed loop for a single beauty store (or brand with 1–N locations):

| Domain | Why |
|--------|-----|
| Customer + Consultation + Notes | CRM core already partially built |
| Appointment | Today board / scheduling |
| Treatment | Existing workflow — keep |
| Checkout (basic) | Convert visits to revenue |
| Package / Credit ledger | SPA dependency |
| Payment (cash/card/SV stubs) | Mixed tender foundation |
| Follow Up / Rebooking (basic) | Retention |

### NEXT

| Domain | Why wait |
|--------|----------|
| Multi-location UX polish | After IA + location switcher maturity |
| Advanced reports | Needs settled transactions |
| **Product retail catalog** | **Done in 4.10B** |
| **Location inventory ledger** | **Done in 4.10C** (no PO/transfer/cost) |
| Simple stock / inventory extras | Transfer · reorder · cost — later |
| Fine-grained RBAC UI | After roles stabilize |
| CRM segments / reminders automation | After follow-up basics |
| Entitlement enforcement UI | After billing intent |

### LATER

| Domain | Why |
|--------|-----|
| Full inventory / transfers | Operational complexity |
| AI assistants | Not required for core loop |
| Payroll / accounting export | Adjacent systems |
| Advanced marketing automation | LINE/SMS integrations |
| White-label / custom domains | Platform maturity |
| Platform Admin full suite | After multi-tenant production Auth |

---

## Navigation recommendation (IA only)

### Desktop (≥1200)

Suggested modules:

| Nav | Contains |
|-----|----------|
| **Today** | Day board, start treatment (exists) |
| **Calendar** | Week/month appointments |
| **Customers** | CRM (exists) |
| **Treatments** | History / continue drafts |
| **Sales** | Checkout · Packages · Products · Transactions |
| **CRM** | Follow-ups · Rebooking · Segments (light) |
| **Reports** | Revenue · visits · retention |
| **Staff** | Members · roles |
| **Settings** | Org · Locations · Services · Entitlements display |

**Sales** groups commercial surfaces so Bottom Nav stays uncluttered.

### Tablet

Same modules as desktop where width allows; collapse Sales/CRM/Reports under “More” if needed.

### Mobile

Bottom navigation should **not** mirror every desktop module.

Recommended primary tabs:

1. Today  
2. Customers  
3. Calendar (or Appointments)  
4. More → Sales, CRM, Reports, Staff, Settings  

Treatment workspace remains full-screen flow (existing pattern).

### Phase 4.7 note

StaffShell IA / sidebar / mobile More hub implemented — see [navigation-ia.md](./navigation-ia.md).  
Do not regress Treatment / Today / Customer flows when extending Sales placeholders.

### Phase 4.8 note

- **4.8A** — Appointment store + Calendar + Today sync  
- **4.8B** — Staff Day calendar, working hours / breaks / time off, availability engine  
- **4.8B.1** — Calendar visual polish  

### Phase 4.9 note

- **4.9A** — Checkout draft + Transaction + mixed tender  
- **4.9B** — Package ledger + Stored value ledger; Customer Wallet  
- **4.9C** — Core business flow integration audit + hardening  
- **4.9C.1** — `/staff` entry redirect (login / today)  
- Do not treat Appointment COMPLETED as paid.

### Phase 4.10 note

- **4.10A** — Full Transaction void + package / SV ledger reversal  
- **4.10B** — Product catalog + retail checkout  
- **4.10C** — Location inventory movements + sale/void stock  
- **Next (recommended)** — Stock transfer / low-stock alerts, or Partial refund — pick deliberately  

---

## Compatibility with current UI

| Current | Maps to |
|---------|---------|
| Today | Today |
| Customers | Customers |
| Appointments (Coming Soon) | Calendar / Appointments |
| Notifications | Later CRM/alerts |
| More → Org / Locations settings | Settings |
| Treatment routes | Treatments |

---

## Success criteria for MVP CORE

A therapist can: book → check-in → treat → checkout (package redeem or pay) → set follow-up → rebook — **within one Organization**, with location recorded on appointment/transaction.
