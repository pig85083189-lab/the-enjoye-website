"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StepFooter } from "@/features/treatments/StepFooter";
import type { TreatmentTemplate } from "@/types/treatment-template";
import { cn } from "@/lib/utils";

interface OperationsStepProps {
  template: TreatmentTemplate;
  operations: string[];
  products: string[];
  onOperationsChange: (next: string[]) => void;
  onProductsChange: (next: string[]) => void;
  onBack: () => void;
  onNext: () => void;
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export function OperationsStep({
  template,
  operations,
  products,
  onOperationsChange,
  onProductsChange,
  onBack,
  onNext,
}: OperationsStepProps) {
  const [appliedCount, setAppliedCount] = useState<number | null>(null);

  function applyProtocol() {
    const next = Array.from(new Set([...operations, ...template.standardProtocol]));
    onOperationsChange(next);
    setAppliedCount(template.standardProtocol.length);
  }

  function clearAll() {
    onOperationsChange([]);
    setAppliedCount(null);
  }

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-text">本次操作項目</h1>
        <p className="mt-2 text-[15px] text-secondary-text">快速勾選今天實際執行的項目</p>
      </header>

      {template.standardProtocol.length > 0 ? (
        <Card padding="md" className="mb-4">
          <h2 className="text-base font-semibold text-text">{template.name} 標準流程</h2>
          <p className="mt-1 text-sm text-secondary-text">
            一鍵套用後仍可個別取消或新增
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={applyProtocol}>套用標準流程</Button>
            <Button variant="ghost" onClick={clearAll}>
              清除全部
            </Button>
          </div>
          {appliedCount !== null ? (
            <p className="mt-3 text-sm text-primary">已套用 {appliedCount} 項標準操作</p>
          ) : null}
        </Card>
      ) : null}

      <div className="space-y-4">
        {template.operationGroups.map((group) => (
          <Card key={group.id} padding="md">
            <h2 className="text-base font-semibold text-text">{group.title}</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {group.items.map((item) => {
                const selected = operations.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setAppliedCount(null);
                      onOperationsChange(toggle(operations, item.id));
                    }}
                    className={cn(
                      "min-h-12 rounded-2xl border px-4 text-left text-sm font-medium transition-colors",
                      selected
                        ? "border-primary bg-primary-light text-primary"
                        : "border-border bg-surface text-text hover:border-primary/40",
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </Card>
        ))}

        <Card padding="md" className="border-primary/20 bg-primary-light/20">
          <h2 className="text-base font-semibold text-text">產品</h2>
          <p className="mt-1 text-sm text-secondary-text">與操作項目分開記錄</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {template.products.map((item) => {
              const selected = products.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onProductsChange(toggle(products, item.id))}
                  className={cn(
                    "min-h-12 rounded-2xl border px-4 text-left text-sm font-medium transition-colors",
                    selected
                      ? "border-primary bg-surface text-primary"
                      : "border-border bg-surface text-text hover:border-primary/40",
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      <StepFooter onBack={onBack} onNext={onNext} nextLabel="下一步：照片紀錄" />
    </div>
  );
}
