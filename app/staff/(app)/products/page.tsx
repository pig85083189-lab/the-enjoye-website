import { ModulePlaceholder } from "@/components/navigation/ModulePlaceholder";

export default function ProductsPage() {
  return (
    <ModulePlaceholder
      title="商品"
      description="零售商品為後續 Phase。此頁僅保留 IA 入口。"
      phaseHint="標示為 future — 不實作庫存或銷售邏輯。"
    />
  );
}
