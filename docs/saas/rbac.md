# RBAC Architecture

Phase 4.6 design. **Do not rewrite Phase 4.5B authorization** in this phase.

Current prototype: membership existence + role label + `locationIds` (not full permission matrix).

---

## Identity model

```text
User (Auth identity)
  └── StaffMembership (per Organization)
        ├── role
        ├── locationIds[]
        ├── displayName
        └── isActive
```

One user may have memberships in multiple organizations (dev switcher already demonstrates Enjoye OWNER + Lumière STAFF).

---

## Roles (future)

| Role | Intent |
|------|--------|
| `OWNER` | Full org control; all locations |
| `MANAGER` | Ops + reports + staff (limited); multi-location as assigned |
| `STAFF` | Treatments, customers, own schedule |
| `RECEPTIONIST` | Appointments, check-in, checkout, customer create |
| `ACCOUNTANT` | Transactions/reports read (optional later) |
| `CUSTOM` | Role templates composed of permissions (later) |

Roles are **bundles of permissions**, not the only authorization check.

---

## Permission keys (examples)

```text
customer.read
customer.write
consultation.read
consultation.write
appointment.read
appointment.write
treatment.read
treatment.write
checkout.create
transaction.read
transaction.refund
package.read
package.adjust
report.read
staff.manage
settings.manage
location.manage
```

Authorization check (future server):

```text
hasMembership(org)
AND permission granted via role (or custom grants)
AND (resource.location_id IN membership.locationIds
     OR role is OWNER
     OR permission is org-wide)
```

---

## Location-level access

| Role | Default location rule |
|------|----------------------|
| OWNER | All locations |
| MANAGER | Assigned `locationIds` (may be all) |
| STAFF / RECEPTIONIST | Assigned stores only |

Examples:

- Therapist only works 台中店 → `locationIds = [taichung]`.  
- Cannot open 台北店 Today board or create 台北 appointments.  
- Customer profile is org-wide readable if `customer.read`; creating appointment still requires location permission for that store.

---

## Platform vs Organization RBAC

| Concern | System |
|---------|--------|
| Impersonate / suspend tenant | **Platform Admin** |
| Manage org staff & services | **Organization** membership permissions |
| Cross-tenant data | Never via org roles |

See [platform-admin.md](./platform-admin.md).

---

## Relation to Phase 4.5B

| 4.5B | Future |
|------|--------|
| `canAccessOrganization` | Keep as membership gate |
| `canAccessLocation` | Keep; extend with permission matrix |
| Role on membership | Expand to permission map |
| Client-side checks | UX only; server + RLS enforce |

---

## MVP permission subset

For first commercial MVP, enforce at least:

- membership active  
- location assignment for appointment/treatment/checkout writes  
- OWNER/MANAGER for settings & staff.manage  

Fine-grained custom roles can wait until NEXT.
