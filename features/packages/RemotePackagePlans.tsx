"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatTwd } from "@/lib/commerce/money";

type Service = { id: string; name: string; is_active: boolean };
type Definition = { id: string; name: string; session_count: number; price_minor: number; is_active: boolean; included_services: Array<{ serviceId: string }> };
export function RemotePackagePlans({ organizationId }: { organizationId: string }) {
  const [services, setServices] = useState<Service[]>([]);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [sessions, setSessions] = useState("10");
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("");
  const [saving, setSaving] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/staff/packages/overview?" + new URLSearchParams({ organizationId }), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "無法讀取正式套票");
      setDefinitions(data.definitions);
      setServices(data.services);
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "無法讀取正式套票"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [organizationId]);
  async function save() {
    if (!name.trim() || !selected.length || !Number.isSafeInteger(Number(sessions)) || Number(sessions) < 1 ||
      !/^\d+$/.test(price) || (days && (!/^\d+$/.test(days) || Number(days) < 1))) {
      setError("請填寫套票名稱、指定療程、有效堂數及非負整數價格");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/staff/packages/definitions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, name: name.trim(), serviceIds: selected, sessionCount: Number(sessions),
          priceMinor: Number(price), validityDays: days ? Number(days) : null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "建立失敗");
      setName(""); setSelected([]); setPrice(""); setDays("");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "建立失敗"); }
    finally { setSaving(false); }
  }
  return <div className="space-y-4">
    <h1 className="text-xl font-semibold text-text">正式套票方案</h1>
    <p className="text-sm text-secondary-text">套票僅限指定療程使用。購買與扣堂數待交易驗證完成後開放。</p>
    {error ? <p role="alert" className="text-sm text-[#B07A4A]">{error}</p> : null}
    <Card padding="md" className="space-y-3">
      <h2 className="font-semibold">新增指定療程套票</h2>
      <label className="block text-sm">套票名稱<input className="mt-1 w-full rounded-xl border border-border p-3" value={name} onChange={e => setName(e.target.value)} maxLength={120}/></label>
      <fieldset><legend className="text-sm">指定療程</legend>
        {services.filter(s => s.is_active).map(s => <label key={s.id} className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev,s.id] : prev.filter(id => id !== s.id))}/>{s.name}
        </label>)}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">總堂數<input type="number" min="1" step="1" className="mt-1 w-full rounded-xl border border-border p-3" value={sessions} onChange={e=>setSessions(e.target.value)}/></label>
        <label className="text-sm">售價（元）<input type="number" min="0" step="1" className="mt-1 w-full rounded-xl border border-border p-3" value={price} onChange={e=>setPrice(e.target.value)}/></label>
      </div>
      <label className="block text-sm">有效天數（留空表示不限制）<input type="number" min="1" step="1" className="mt-1 w-full rounded-xl border border-border p-3" value={days} onChange={e=>setDays(e.target.value)}/></label>
      <Button onClick={() => void save()} disabled={saving || loading}>{saving ? "儲存中…" : "建立正式套票方案"}</Button>
    </Card>
    <Card padding="md" className="space-y-3">
      <h2 className="font-semibold">正式方案列表</h2>
      {loading ? <p className="text-sm">讀取中…</p> : definitions.length === 0 ? <p className="text-sm text-secondary-text">目前尚無正式套票方案</p> :
        definitions.map(d => <div key={d.id} className="rounded-xl border border-border p-3">
          <p className="font-medium">{d.name}</p>
          <p className="text-sm text-secondary-text">{d.session_count} 堂 · {formatTwd(d.price_minor)} · {d.is_active ? "販售中" : "停售"}</p>
          <p className="text-xs text-secondary-text">{(d.included_services ?? []).map(item => services.find(s => s.id === item.serviceId)?.name ?? "未知療程").join("、")}</p>
        </div>)}
    </Card>
  </div>;
}
