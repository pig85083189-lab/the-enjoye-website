import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";

interface ImportantNotesAlertProps {
  notes: string[];
}

export function ImportantNotesAlert({ notes }: ImportantNotesAlertProps) {
  if (!notes.length) return null;

  return (
    <Card
      padding="md"
      className="border-[#E8D5C4] bg-[#FBF6F0] shadow-none"
      role="status"
    >
      <div className="flex gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F8EEE4] text-[#B07A4A]">
          <AlertTriangle className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-text">⚠ 注意事項</h2>
          <ul className="mt-2 space-y-1.5">
            {notes.map((note) => (
              <li key={note} className="text-[15px] leading-relaxed text-text">
                {note}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-secondary-text">僅供內部服務紀錄使用</p>
        </div>
      </div>
    </Card>
  );
}
