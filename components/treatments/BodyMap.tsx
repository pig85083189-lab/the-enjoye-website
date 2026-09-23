"use client";

import { useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
  BODY_MAP_CIRCLED_NUMBERS,
  BreastBodyMapSvg,
} from "@/components/treatments/body-maps/BreastBodyMap";
import { QuickSelect } from "@/components/treatments/QuickSelect";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getBodyAreaLabel } from "@/data/treatment-options";
import { createId } from "@/lib/treatment-draft";
import type { BodyMarker } from "@/types/treatment";
import type { BodyMapType, TemplateBodyArea } from "@/types/treatment-template";
import { cn } from "@/lib/utils";

interface BodyMapProps {
  mapType: BodyMapType;
  areas: TemplateBodyArea[];
  conditions: string[];
  markers: BodyMarker[];
  suggestedTrackingAreas?: string[];
  onChange: (markers: BodyMarker[]) => void;
}

export function BodyMap({
  mapType,
  areas,
  conditions,
  markers,
  suggestedTrackingAreas = [],
  onChange,
}: BodyMapProps) {
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [localConditions, setLocalConditions] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const markerIndexByArea = useMemo(() => {
    const map = new Map<string, number>();
    markers.forEach((marker, index) => map.set(marker.area, index));
    return map;
  }, [markers]);

  function startArea(areaId: string) {
    const existing = markers.find((m) => m.area === areaId);
    setSelectedArea(areaId);
    if (existing) {
      setEditingId(existing.id);
      setLocalConditions(existing.conditions);
      setNote(existing.note);
    } else {
      setEditingId(null);
      setLocalConditions([]);
      setNote("");
    }
  }

  function saveMarker() {
    if (!selectedArea || localConditions.length === 0) return;
    const payload: BodyMarker = {
      id: editingId ?? createId("marker"),
      area: selectedArea,
      conditions: localConditions,
      note,
    };
    const without = markers.filter((m) => m.area !== selectedArea);
    onChange([...without, payload]);
    setSelectedArea(null);
    setEditingId(null);
    setLocalConditions([]);
    setNote("");
  }

  function removeMarker(id: string) {
    onChange(markers.filter((m) => m.id !== id));
    if (editingId === id) {
      setSelectedArea(null);
      setEditingId(null);
    }
  }

  function editMarker(marker: BodyMarker) {
    setSelectedArea(marker.area);
    setEditingId(marker.id);
    setLocalConditions(marker.conditions);
    setNote(marker.note);
  }

  if (mapType !== "BREAST" && mapType !== "GENERIC") {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-base font-semibold text-text">此 Body Map 類型即將推出</p>
        <p className="mt-2 text-sm text-secondary-text">mapType: {mapType}</p>
        <p className="mt-4 text-sm text-secondary-text">請先使用部位備註記錄重點。</p>
      </Card>
    );
  }

  if (mapType === "GENERIC") {
    return (
      <div className="space-y-4">
        <Card padding="md">
          <p className="text-base font-semibold text-text">此療程目前使用通用部位紀錄</p>
          <p className="mt-2 text-sm text-secondary-text">
            尚未提供專屬 Body Map，可點選下方區域快速標記。
          </p>
        </Card>
        <GenericAreaPicker
          areas={areas}
          conditions={conditions}
          markers={markers}
          selectedArea={selectedArea}
          localConditions={localConditions}
          note={note}
          editingId={editingId}
          onStartArea={startArea}
          onConditionsChange={setLocalConditions}
          onNoteChange={setNote}
          onSave={saveMarker}
          onCancel={() => {
            setSelectedArea(null);
            setEditingId(null);
          }}
          onEdit={editMarker}
          onRemove={removeMarker}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <Card padding="md" className="overflow-hidden">
        <p className="mb-3 text-sm text-secondary-text">點選部位標記狀況</p>
        <BreastBodyMapSvg
          areas={areas}
          selectedAreaId={selectedArea}
          markerIndexByArea={markerIndexByArea}
          onSelectArea={startArea}
        />
        <p className="mt-3 text-center text-xs text-secondary-text">
          左右以客人本人方向為準
        </p>
        {suggestedTrackingAreas.length > 0 ? (
          <div className="mt-4 rounded-2xl bg-primary-light/40 px-3 py-2.5">
            <p className="text-xs font-medium text-primary">建議追蹤區域</p>
            <p className="mt-1 text-sm text-text">{suggestedTrackingAreas.join("、")}</p>
          </div>
        ) : null}
      </Card>

      <div className="space-y-4">
        {selectedArea ? (
          <Card padding="md">
            <p className="text-sm text-secondary-text">目前選擇</p>
            <h3 className="mt-1 text-lg font-semibold text-text">
              {getBodyAreaLabel(selectedArea, areas)}
            </h3>
            <p className="mt-3 text-sm text-secondary-text">狀況（可複選）</p>
            <QuickSelect
              className="mt-2"
              options={conditions}
              value={localConditions}
              onChange={setLocalConditions}
            />
            <label className="mt-4 block">
              <span className="text-sm text-secondary-text">部位備註（選填）</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                className="mt-1.5 w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                placeholder="例如：右側較左側緊，觸感偏硬。"
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={saveMarker} disabled={localConditions.length === 0}>
                {editingId ? "更新紀錄" : "加入紀錄"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedArea(null);
                  setEditingId(null);
                }}
              >
                取消
              </Button>
            </div>
          </Card>
        ) : (
          <Card padding="md">
            <p className="text-sm text-secondary-text">點選左側部位開始快速標記</p>
          </Card>
        )}

        <MarkerList
          markers={markers}
          areas={areas}
          selectedArea={selectedArea}
          onEdit={editMarker}
          onRemove={removeMarker}
        />
      </div>
    </div>
  );
}

function MarkerList({
  markers,
  areas,
  selectedArea,
  onEdit,
  onRemove,
}: {
  markers: BodyMarker[];
  areas: TemplateBodyArea[];
  selectedArea: string | null;
  onEdit: (marker: BodyMarker) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Card padding="md">
      <h3 className="text-base font-semibold text-text">已標記部位</h3>
      {markers.length === 0 ? (
        <p className="mt-3 text-sm text-secondary-text">尚未標記</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {markers.map((marker, index) => (
            <li
              key={marker.id}
              className={cn(
                "rounded-2xl border border-border bg-background px-3 py-3",
                selectedArea === marker.area && "border-primary/40 bg-primary-light/30",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-text">
                    <span className="mr-1.5 text-primary">
                      {BODY_MAP_CIRCLED_NUMBERS[index] ?? index + 1}
                    </span>
                    {getBodyAreaLabel(marker.area, areas)}
                  </p>
                  <p className="mt-1 text-sm text-secondary-text">
                    {marker.conditions.join("・")}
                  </p>
                  {marker.note ? (
                    <p className="mt-1 text-sm text-text">{marker.note}</p>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-secondary-text hover:bg-primary-light hover:text-primary"
                    aria-label={`編輯${getBodyAreaLabel(marker.area, areas)}`}
                    onClick={() => onEdit(marker)}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-secondary-text hover:bg-[#F7E8E8] hover:text-danger"
                    aria-label={`刪除${getBodyAreaLabel(marker.area, areas)}`}
                    onClick={() => onRemove(marker.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function GenericAreaPicker({
  areas,
  conditions,
  markers,
  selectedArea,
  localConditions,
  note,
  editingId,
  onStartArea,
  onConditionsChange,
  onNoteChange,
  onSave,
  onCancel,
  onEdit,
  onRemove,
}: {
  areas: TemplateBodyArea[];
  conditions: string[];
  markers: BodyMarker[];
  selectedArea: string | null;
  localConditions: string[];
  note: string;
  editingId: string | null;
  onStartArea: (id: string) => void;
  onConditionsChange: (next: string[]) => void;
  onNoteChange: (note: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onEdit: (marker: BodyMarker) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Card padding="md">
        <div className="flex flex-wrap gap-2">
          {areas.map((area) => (
            <button
              key={area.id}
              type="button"
              onClick={() => onStartArea(area.id)}
              className={cn(
                "min-h-11 rounded-2xl border px-4 text-sm font-medium",
                selectedArea === area.id
                  ? "border-primary bg-primary-light text-primary"
                  : "border-border text-text",
              )}
            >
              {area.label}
            </button>
          ))}
        </div>
      </Card>
      {selectedArea ? (
        <Card padding="md">
          <h3 className="text-lg font-semibold text-text">
            {getBodyAreaLabel(selectedArea, areas)}
          </h3>
          <QuickSelect
            className="mt-3"
            options={conditions}
            value={localConditions}
            onChange={onConditionsChange}
          />
          <textarea
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            rows={2}
            className="mt-3 w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            placeholder="部位備註（選填）"
          />
          <div className="mt-3 flex gap-2">
            <Button onClick={onSave} disabled={localConditions.length === 0}>
              {editingId ? "更新紀錄" : "加入紀錄"}
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              取消
            </Button>
          </div>
        </Card>
      ) : null}
      <MarkerList
        markers={markers}
        areas={areas}
        selectedArea={selectedArea}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </div>
  );
}
