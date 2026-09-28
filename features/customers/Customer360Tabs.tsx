"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  CUSTOMER_360_FINANCIAL_ITEMS,
  CUSTOMER_360_PRIMARY_TABS,
  isFinancialTab,
  type Customer360TabId,
  type Customer360WalletSection,
} from "@/lib/customers/customer-360";
import { cn } from "@/lib/utils";

interface Customer360TabsProps {
  tab: Customer360TabId;
  walletSection?: Customer360WalletSection;
  onSelect: (tab: Customer360TabId, section?: Customer360WalletSection) => void;
}

export function Customer360Tabs({ tab, walletSection, onSelect }: Customer360TabsProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const financialActive = isFinancialTab(tab);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="min-w-0 border-b border-border">
      <div
        role="tablist"
        aria-label="客戶資料分頁"
        className="flex min-w-0 items-stretch gap-0 overflow-x-auto overscroll-x-contain pb-px [-ms-overflow-style:none] [scrollbar-width:none] min-[1200px]:overflow-visible [&::-webkit-scrollbar]:hidden"
      >
        {CUSTOMER_360_PRIMARY_TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`customer-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`customer-tabpanel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(item.id)}
              className={cn(
                "min-h-11 shrink-0 border-b-2 px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 min-[768px]:px-4 min-[768px]:text-sm",
                selected
                  ? "border-primary text-primary"
                  : "border-transparent text-secondary-text hover:text-text",
              )}
            >
              {item.label}
            </button>
          );
        })}
        <div ref={wrapRef} className="relative shrink-0">
          <button
            type="button"
            role="tab"
            id="customer-tab-financial"
            aria-selected={financialActive}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((value) => !value)}
            className={cn(
              "inline-flex min-h-11 items-center gap-1 border-b-2 px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 min-[768px]:px-4 min-[768px]:text-sm",
              financialActive
                ? "border-primary text-primary"
                : "border-transparent text-secondary-text hover:text-text",
            )}
          >
            財務
            <ChevronDown className={cn("h-3.5 w-3.5", open && "rotate-180")} aria-hidden />
          </button>
          {open ? (
            <div
              id={menuId}
              role="menu"
              aria-label="財務"
              className="absolute left-0 z-30 mt-1 min-w-[8.5rem] rounded-2xl border border-border bg-surface p-1 shadow-[0_8px_24px_rgba(48,43,43,0.08)]"
            >
              {CUSTOMER_360_FINANCIAL_ITEMS.map((item) => {
                const selected =
                  item.id === "transactions"
                    ? tab === "transactions"
                    : tab === "wallet" &&
                      (walletSection === item.section ||
                        (!walletSection && item.section === "packages"));
                return (
                  <button
                    key={`${item.id}-${item.section ?? "tx"}`}
                    type="button"
                    role="menuitem"
                    className={cn(
                      "flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm text-text hover:bg-[#FBF4F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      selected && "bg-[#FBF4F3] text-primary",
                    )}
                    onClick={() => {
                      onSelect(item.id, item.section);
                      setOpen(false);
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
