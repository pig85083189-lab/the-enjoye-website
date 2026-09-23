/**
 * Phase 4.5A + 4.5B — Tenant isolation & boundary hardening suite.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
  LOC_ENJOYE_PRIMARY_ID,
  LOC_LUMIERE_PRIMARY_ID,
  LEGACY_GLOBAL_LOCATION_KEY,
  CURRENT_ORG_STORAGE_KEY,
} from "@/lib/tenant/constants";
import {
  getConsultationDraftKey,
  getCurrentLocationStorageKey,
  getTenantStorageKey,
  getTreatmentDraftKey,
} from "@/lib/tenant/storage-keys";
import {
  assertOrganizationAccess,
  belongsToOrganization,
  canAccessLocation,
  canAccessOrganization,
  OrganizationAccessError,
  resolveAccessibleOrganizationId,
} from "@/lib/tenant/access";
import {
  getStoredOrganizationId,
  listLocations,
  migrateLegacyLocationPointer,
  persistCurrentLocation,
  persistOrganizationId,
  readPersistedLocationId,
  resolveCurrentLocation,
} from "@/lib/tenant/organization-store";
import { setActiveOrganizationId } from "@/lib/tenant/active-organization";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { localCustomerNoteRepository } from "@/lib/repositories/local-note-repository";
import { localConsultationRepository } from "@/lib/repositories/local-consultation-repository";
import { localAppointmentRepository } from "@/lib/repositories/local-appointment-repository";
import { localTreatmentRepository } from "@/lib/repositories/local-treatment-repository";
import { localCustomerPhotoRepository } from "@/lib/repositories/local-photo-repository";
import {
  clearConsultationDraft,
  loadConsultationDraft,
  saveConsultationDraft,
} from "@/lib/repositories/consultation-draft";
import {
  clearDraft,
  loadDraft,
  saveDraft,
  createEmptyDraft,
  saveCompletedTreatment,
} from "@/lib/treatment-draft";
import { getLiveAppointments } from "@/lib/appointment-store";
import { getServiceById } from "@/data/mock-services";
import type { Customer } from "@/types";

const DEMO_USER = "staff-001";
const UNAUTH_USER = "user-without-membership";

function wipeLocalStorage() {
  localStorage.clear();
}

function minimalCustomer(
  partial: Partial<Customer> & Pick<Customer, "id" | "organizationId" | "name">,
): Customer {
  const now = new Date().toISOString();
  return {
    phone: "0900-000-000",
    birthday: "1990/01/01",
    age: 36,
    membership: "new",
    lastVisit: "",
    totalVisits: 0,
    packages: [],
    lastServiceNotes: [],
    trackingFocus: [],
    alerts: [],
    tags: [],
    joinedAt: "2026/01/01",
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

beforeEach(() => {
  wipeLocalStorage();
  setActiveOrganizationId(ORG_ENJOYE_ID);
});

describe("storage key isolation", () => {
  it("builds distinct tenant keys", () => {
    const a = getTenantStorageKey(ORG_ENJOYE_ID, "customers");
    const b = getTenantStorageKey(ORG_LUMIERE_ID, "customers");
    expect(a).not.toBe(b);
    expect(getConsultationDraftKey(ORG_ENJOYE_ID, "new")).toContain(ORG_ENJOYE_ID);
    expect(getTreatmentDraftKey(ORG_LUMIERE_ID, "apt-1")).toContain(ORG_LUMIERE_ID);
    expect(getCurrentLocationStorageKey(ORG_ENJOYE_ID)).toContain(ORG_ENJOYE_ID);
  });
});

describe("membership boundary / switchOrganization", () => {
  it("rejects unauthorized switchOrganization", () => {
    const ok = persistOrganizationId(ORG_ENJOYE_ID, UNAUTH_USER);
    expect(ok).toBe(false);
    expect(localStorage.getItem(CURRENT_ORG_STORAGE_KEY)).toBeNull();
  });

  it("authorized switch succeeds", () => {
    expect(persistOrganizationId(ORG_ENJOYE_ID, DEMO_USER)).toBe(true);
    expect(localStorage.getItem(CURRENT_ORG_STORAGE_KEY)).toBe(ORG_ENJOYE_ID);
    expect(persistOrganizationId(ORG_LUMIERE_ID, DEMO_USER)).toBe(true);
    expect(localStorage.getItem(CURRENT_ORG_STORAGE_KEY)).toBe(ORG_LUMIERE_ID);
  });

  it("rejects nonexistent organization", () => {
    expect(persistOrganizationId("org-does-not-exist", DEMO_USER)).toBe(false);
    expect(canAccessOrganization(DEMO_USER, "org-does-not-exist")).toBe(false);
  });

  it("rejects invalid persisted organization and falls back", () => {
    localStorage.setItem(CURRENT_ORG_STORAGE_KEY, "org-hacker");
    const resolved = getStoredOrganizationId(DEMO_USER);
    expect(resolved).toBe(ORG_ENJOYE_ID);
    expect(localStorage.getItem(CURRENT_ORG_STORAGE_KEY)).toBe(ORG_ENJOYE_ID);
  });

  it("resolveAccessibleOrganizationId fails closed for unauthorized preferred", () => {
    expect(resolveAccessibleOrganizationId(UNAUTH_USER, ORG_ENJOYE_ID)).toBeNull();
    expect(resolveAccessibleOrganizationId(DEMO_USER, ORG_LUMIERE_ID)).toBe(
      ORG_LUMIERE_ID,
    );
  });
});

describe("switchLocation ownership", () => {
  it("rejects cross-org location switch", () => {
    expect(persistCurrentLocation(ORG_ENJOYE_ID, LOC_LUMIERE_PRIMARY_ID)).toBe(false);
    expect(readPersistedLocationId(ORG_ENJOYE_ID)).toBeNull();
  });

  it("valid location succeeds", () => {
    expect(persistCurrentLocation(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID)).toBe(true);
    expect(readPersistedLocationId(ORG_ENJOYE_ID)).toBe(LOC_ENJOYE_PRIMARY_ID);
  });

  it("location key is org scoped", () => {
    persistCurrentLocation(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID);
    persistCurrentLocation(ORG_LUMIERE_ID, LOC_LUMIERE_PRIMARY_ID);
    expect(localStorage.getItem(getCurrentLocationStorageKey(ORG_ENJOYE_ID))).toBe(
      LOC_ENJOYE_PRIMARY_ID,
    );
    expect(localStorage.getItem(getCurrentLocationStorageKey(ORG_LUMIERE_ID))).toBe(
      LOC_LUMIERE_PRIMARY_ID,
    );
  });

  it("legacy global location migrates when valid for org", () => {
    localStorage.setItem(LEGACY_GLOBAL_LOCATION_KEY, LOC_ENJOYE_PRIMARY_ID);
    migrateLegacyLocationPointer(ORG_ENJOYE_ID);
    expect(localStorage.getItem(getCurrentLocationStorageKey(ORG_ENJOYE_ID))).toBe(
      LOC_ENJOYE_PRIMARY_ID,
    );
    expect(localStorage.getItem(LEGACY_GLOBAL_LOCATION_KEY)).toBeNull();
  });

  it("invalid legacy location is ignored", () => {
    localStorage.setItem(LEGACY_GLOBAL_LOCATION_KEY, LOC_LUMIERE_PRIMARY_ID);
    migrateLegacyLocationPointer(ORG_ENJOYE_ID);
    expect(localStorage.getItem(getCurrentLocationStorageKey(ORG_ENJOYE_ID))).toBeNull();
    expect(localStorage.getItem(LEGACY_GLOBAL_LOCATION_KEY)).toBeNull();
    const resolved = resolveCurrentLocation(ORG_ENJOYE_ID);
    expect(resolved?.id).toBe(LOC_ENJOYE_PRIMARY_ID);
  });

  it("persisted B location does not apply under A", () => {
    localStorage.setItem(
      getCurrentLocationStorageKey(ORG_ENJOYE_ID),
      LOC_LUMIERE_PRIMARY_ID,
    );
    const resolved = resolveCurrentLocation(ORG_ENJOYE_ID);
    expect(resolved?.id).toBe(LOC_ENJOYE_PRIMARY_ID);
    expect(canAccessLocation(ORG_ENJOYE_ID, LOC_LUMIERE_PRIMARY_ID)).toBe(false);
  });
});

describe("service lookup tenant scoped", () => {
  it("requires matching organization", () => {
    expect(getServiceById("svc-breast", ORG_ENJOYE_ID)?.name).toContain("美胸");
    expect(getServiceById("svc-breast", ORG_LUMIERE_ID)).toBeUndefined();
    expect(getServiceById("svc-lumiere-facial", ORG_LUMIERE_ID)?.name).toContain("光感");
    expect(getServiceById("svc-lumiere-facial", ORG_ENJOYE_ID)).toBeUndefined();
  });
});

describe("customer isolation", () => {
  it("lists only THE ENJOYE customers for Enjoye org", () => {
    const list = localCustomerRepository.list({ organizationId: ORG_ENJOYE_ID });
    expect(list.every((c) => c.organizationId === ORG_ENJOYE_ID)).toBe(true);
    expect(list.some((c) => c.name === "王小美")).toBe(true);
  });

  it("cross-tenant getById returns undefined", () => {
    expect(
      localCustomerRepository.getById({
        organizationId: ORG_LUMIERE_ID,
        id: "demo-001",
      }),
    ).toBeUndefined();
  });
});

describe("same-ID collision", () => {
  it("same customer id stays isolated", () => {
    const sharedId = "customer-001";
    localCustomerRepository.upsert(
      minimalCustomer({
        id: sharedId,
        organizationId: ORG_ENJOYE_ID,
        name: "Enjoye Twin",
      }),
    );
    localCustomerRepository.upsert(
      minimalCustomer({
        id: sharedId,
        organizationId: ORG_LUMIERE_ID,
        name: "Lumiere Twin",
      }),
    );
    expect(
      localCustomerRepository.getById({
        organizationId: ORG_ENJOYE_ID,
        id: sharedId,
      })?.name,
    ).toBe("Enjoye Twin");
    expect(
      localCustomerRepository.getById({
        organizationId: ORG_LUMIERE_ID,
        id: sharedId,
      })?.name,
    ).toBe("Lumiere Twin");
  });

  it("same appointment id stays isolated", () => {
    const enjoye = getLiveAppointments(ORG_ENJOYE_ID);
    const lumiere = getLiveAppointments(ORG_LUMIERE_ID);
    expect(enjoye.every((a) => a.organizationId === ORG_ENJOYE_ID)).toBe(true);
    expect(lumiere.every((a) => a.organizationId === ORG_LUMIERE_ID)).toBe(true);

    const sharedApt = "shared-apt-collision";
    expect(
      localAppointmentRepository.getById({
        organizationId: ORG_ENJOYE_ID,
        id: sharedApt,
      }),
    ).toBeUndefined();
    expect(
      localAppointmentRepository.listByCustomer({
        organizationId: ORG_LUMIERE_ID,
        customerId: "demo-001",
      }),
    ).toEqual([]);
  });

  it("same treatment id stays isolated", () => {
    const draft = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      appointmentId: "collision-apt",
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: "svc-breast",
    });
    draft.id = "treatment-shared-id";
    draft.professionalNote = "enjoye-only";
    saveCompletedTreatment(draft);

    expect(
      localTreatmentRepository.getById({
        organizationId: ORG_ENJOYE_ID,
        id: "treatment-shared-id",
      })?.professionalNote,
    ).toBe("enjoye-only");
    expect(
      localTreatmentRepository.getById({
        organizationId: ORG_LUMIERE_ID,
        id: "treatment-shared-id",
      }),
    ).toBeUndefined();
  });
});

describe("consultation / notes / photos / drafts", () => {
  it("consultations scoped", () => {
    const enjoye = localConsultationRepository.listByCustomer({
      organizationId: ORG_ENJOYE_ID,
      customerId: "demo-001",
    });
    expect(enjoye.length).toBeGreaterThan(0);
    expect(
      localConsultationRepository.getById({
        organizationId: ORG_LUMIERE_ID,
        id: enjoye[0]!.id,
      }),
    ).toBeUndefined();
  });

  it("notes scoped", () => {
    expect(
      localCustomerNoteRepository.listByCustomer({
        organizationId: ORG_LUMIERE_ID,
        customerId: "demo-001",
      }),
    ).toEqual([]);
  });

  it("photos scoped", () => {
    expect(
      localCustomerPhotoRepository.listByCustomer({
        organizationId: ORG_LUMIERE_ID,
        customerId: "demo-001",
      }),
    ).toEqual([]);
  });

  it("draft isolation", () => {
    saveConsultationDraft({
      organizationId: ORG_ENJOYE_ID,
      customerId: "new",
      step: 2,
      form: { name: "Draft A" },
      updatedAt: new Date().toISOString(),
    });
    saveConsultationDraft({
      organizationId: ORG_LUMIERE_ID,
      customerId: "new",
      step: 1,
      form: { name: "Draft B" },
      updatedAt: new Date().toISOString(),
    });
    expect(loadConsultationDraft(ORG_ENJOYE_ID, "new")?.form.name).toBe("Draft A");
    expect(loadConsultationDraft(ORG_LUMIERE_ID, "new")?.form.name).toBe("Draft B");
    clearConsultationDraft(ORG_ENJOYE_ID, "new");
    expect(loadConsultationDraft(ORG_LUMIERE_ID, "new")?.form.name).toBe("Draft B");

    const aptId = "shared-apt-id";
    const draftA = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      appointmentId: aptId,
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: "svc-breast",
    });
    draftA.clientFeeling = "enjoye-draft";
    saveDraft(draftA);
    const draftB = createEmptyDraft({
      organizationId: ORG_LUMIERE_ID,
      appointmentId: aptId,
      customerId: "lumiere-c-001",
      staffId: "staff-lumiere-01",
      serviceId: "svc-lumiere-facial",
    });
    draftB.clientFeeling = "lumiere-draft";
    saveDraft(draftB);
    expect(loadDraft(ORG_ENJOYE_ID, aptId)?.clientFeeling).toBe("enjoye-draft");
    expect(loadDraft(ORG_LUMIERE_ID, aptId)?.clientFeeling).toBe("lumiere-draft");
    clearDraft(ORG_ENJOYE_ID, aptId);
    expect(loadDraft(ORG_LUMIERE_ID, aptId)?.clientFeeling).toBe("lumiere-draft");
  });

  it("saveDraft / saveCompletedTreatment reject missing organizationId", () => {
    const draft = createEmptyDraft({
      organizationId: ORG_ENJOYE_ID,
      appointmentId: "x",
      customerId: "demo-001",
      staffId: "staff-001",
      serviceId: "svc-breast",
    });
    // Simulate broken payload
    (draft as { organizationId?: string }).organizationId = undefined;
    expect(() => saveDraft(draft)).toThrow(/organizationId is required/);
    expect(() => saveCompletedTreatment(draft)).toThrow(/organizationId is required/);
  });
});

describe("locations list ownership", () => {
  it("locations are filtered by organization", () => {
    expect(listLocations(ORG_ENJOYE_ID).every((l) => l.organizationId === ORG_ENJOYE_ID)).toBe(
      true,
    );
    expect(listLocations(ORG_LUMIERE_ID).some((l) => l.id === LOC_ENJOYE_PRIMARY_ID)).toBe(
      false,
    );
  });
});

describe("access helpers", () => {
  it("assertOrganizationAccess throws on mismatch", () => {
    expect(() => assertOrganizationAccess(ORG_ENJOYE_ID, ORG_LUMIERE_ID)).toThrow(
      OrganizationAccessError,
    );
    expect(belongsToOrganization(ORG_ENJOYE_ID, ORG_ENJOYE_ID)).toBe(true);
  });
});
