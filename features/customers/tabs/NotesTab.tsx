"use client";

import { useState } from "react";
import { Pin } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getSession } from "@/lib/auth";
import { localCustomerNoteRepository } from "@/lib/repositories/local-note-repository";
import { useCrmJson, useIsClient } from "@/lib/repositories/use-crm-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import type { CustomerNote } from "@/types/customer";
import { cn } from "@/lib/utils";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface NotesTabProps {
  customerId: string;
}

export function NotesTab({ customerId }: NotesTabProps) {
  const { organization } = useOrganization();
  const isClient = useIsClient();
  const notes = useCrmJson(
    () =>
      localCustomerNoteRepository.listByCustomer({
        organizationId: organization.id,
        customerId,
      }),
    [] as CustomerNote[],
  );
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);

  function handleSave() {
    const text = content.trim();
    if (!text) return;
    const session = getSession();
    localCustomerNoteRepository.create({
      organizationId: organization.id,
      customerId,
      content: text,
      pinned,
      authorId: session?.staffId ?? "staff-001",
      authorName: session?.name ?? "美容師",
    });
    setContent("");
    setPinned(false);
  }

  return (
    <div className="space-y-4">
      <Card padding="lg" className="space-y-3">
        <h3 className="text-base font-semibold text-text">新增內部備註</h3>
        <p className="text-xs text-secondary-text">僅供員工查看，不與諮詢健康資訊混用</p>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          placeholder="例如：客人比較怕冷、下次記得追蹤右腋下…"
          className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-[15px] text-text outline-none ring-primary/30 focus:ring-2"
        />
        <label className="flex min-h-11 items-center gap-2 text-[15px] text-text">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Pin important
        </label>
        <Button onClick={handleSave} disabled={!content.trim()} className="min-h-11">
          儲存備註
        </Button>
      </Card>

      {!isClient ? (
        <div className="h-24 animate-pulse rounded-2xl bg-primary-light/40" />
      ) : notes.length === 0 ? (
        <Card padding="lg">
          <p className="text-[15px] text-secondary-text">尚無內部備註</p>
        </Card>
      ) : (
        notes.map((note) => (
          <Card
            key={note.id}
            padding="lg"
            className={cn(note.pinned && "border-[#E8D5C4] bg-[#FBF6F0]/30")}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-text">
                {note.content}
              </p>
              {note.pinned ? (
                <Pin className="h-4 w-4 shrink-0 text-[#B07A4A]" aria-label="已釘選" />
              ) : null}
            </div>
            <p className="mt-3 text-sm text-secondary-text">
              {note.authorName} · {formatDateTime(note.createdAt)}
              {note.pinned ? " · Pinned" : ""}
            </p>
          </Card>
        ))
      )}
    </div>
  );
}
