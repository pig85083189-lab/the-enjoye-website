import type { CustomerNote } from "@/types/customer";
import type { CustomerNoteRepository, OrgCustomerQuery } from "./interfaces";
import { SEED_NOTES } from "@/data/seed-crm";
import { SEED_LUMIERE_NOTES } from "@/data/seed-organizations";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";
import { normalizeOrganizationEntity } from "@/lib/tenant/access";
import { newId } from "./storage";
import { readTenantJson, writeTenantJson } from "./tenant-read";

function seedForOrganization(organizationId: string): CustomerNote[] {
  if (organizationId === ORG_ENJOYE_ID) return SEED_NOTES;
  if (organizationId === ORG_LUMIERE_ID) return SEED_LUMIERE_NOTES;
  return [];
}

function mergeWithSeed(existing: CustomerNote[], organizationId: string): CustomerNote[] {
  const seeds = seedForOrganization(organizationId);
  const byId = new Map<string, CustomerNote>();
  for (const seed of seeds) byId.set(seed.id, seed);
  for (const raw of existing) {
    const stamped = normalizeOrganizationEntity(raw, organizationId);
    if (stamped.organizationId !== organizationId) continue;
    byId.set(stamped.id, { ...stamped, organizationId });
  }
  return Array.from(byId.values()).filter((n) => n.organizationId === organizationId);
}

function readAll(organizationId: string): CustomerNote[] {
  if (typeof window === "undefined") return [...seedForOrganization(organizationId)];
  const existing = readTenantJson<CustomerNote[] | null>(
    organizationId,
    "customer-notes",
    null,
  );
  if (existing && Array.isArray(existing) && existing.length > 0) {
    return mergeWithSeed(existing, organizationId);
  }
  return [...seedForOrganization(organizationId)];
}

export class LocalCustomerNoteRepository implements CustomerNoteRepository {
  listByCustomer(query: OrgCustomerQuery): CustomerNote[] {
    return readAll(query.organizationId)
      .filter((n) => n.customerId === query.customerId)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
  }

  create(
    input: Omit<CustomerNote, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): CustomerNote {
    if (!input.organizationId) {
      throw new Error("CustomerNote.organizationId is required");
    }
    const now = new Date().toISOString();
    const note: CustomerNote = {
      id: input.id ?? newId("note"),
      organizationId: input.organizationId,
      customerId: input.customerId,
      content: input.content,
      pinned: input.pinned,
      authorId: input.authorId,
      authorName: input.authorName,
      createdAt: now,
      updatedAt: now,
    };
    const all = readAll(input.organizationId);
    writeTenantJson(input.organizationId, "customer-notes", [note, ...all], "notes");
    return note;
  }

  update(note: CustomerNote): CustomerNote {
    const all = readAll(note.organizationId);
    const next = all.map((n) =>
      n.id === note.id ? { ...note, updatedAt: new Date().toISOString() } : n,
    );
    writeTenantJson(note.organizationId, "customer-notes", next, "notes");
    return note;
  }
}

export const localCustomerNoteRepository = new LocalCustomerNoteRepository();
