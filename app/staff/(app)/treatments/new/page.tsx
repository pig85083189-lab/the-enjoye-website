import { Suspense } from "react";
import { TreatmentPageClient } from "@/features/treatments/TreatmentPageClient";

export default function NewTreatmentPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-secondary-text">
          載入療程工作區…
        </div>
      }
    >
      <TreatmentPageClient />
    </Suspense>
  );
}
