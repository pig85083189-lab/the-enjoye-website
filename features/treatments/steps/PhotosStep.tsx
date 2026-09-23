"use client";

import { useRef } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StepFooter } from "@/features/treatments/StepFooter";
import type { PhotoType, TreatmentPhoto, TreatmentPhotoMeta } from "@/types/treatment";
import type { TreatmentTemplate } from "@/types/treatment-template";
import { createId } from "@/lib/treatment-draft";

interface PhotosStepProps {
  template: TreatmentTemplate;
  treatmentId: string;
  photoMetas: TreatmentPhotoMeta[];
  photos: TreatmentPhoto[];
  onMetasChange: (next: TreatmentPhotoMeta[]) => void;
  onPhotosChange: (next: TreatmentPhoto[]) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

function PhotoSection({
  eyebrow,
  title,
  type,
  treatmentId,
  photos,
  onAdd,
  onRemove,
}: {
  eyebrow: string;
  title: string;
  type: PhotoType;
  treatmentId: string;
  photos: TreatmentPhoto[];
  onAdd: (photo: TreatmentPhoto) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const sectionPhotos = photos.filter((item) => item.type === type);

  function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const previewUrl = URL.createObjectURL(file);
      onAdd({
        id: createId("photo"),
        treatmentId,
        type,
        previewUrl,
        createdAt: new Date().toISOString(),
      });
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-primary">{eyebrow}</p>
          <h2 className="mt-1 text-base font-semibold text-text">{title}</h2>
        </div>
        <span className="rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary">
          {sectionPhotos.length} 張
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          className="min-h-11"
        >
          <Camera className="h-4 w-4" aria-hidden />
          拍照 / 選擇照片
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          className="min-h-11"
        >
          <ImagePlus className="h-4 w-4" aria-hidden />
          上傳照片
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          aria-label={`上傳${title}照片`}
          onChange={(event) => handleFiles(event.target.files)}
        />
      </div>

      {sectionPhotos.length === 0 ? (
        <p className="mt-4 text-sm text-secondary-text">尚未加入照片</p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {sectionPhotos.map((photo) => (
            <li key={photo.id} className="relative overflow-hidden rounded-2xl border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.previewUrl}
                alt={`${title}預覽`}
                className="aspect-[3/4] w-full object-cover"
              />
              <button
                type="button"
                className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface/95 text-danger"
                aria-label="刪除照片"
                onClick={() => {
                  URL.revokeObjectURL(photo.previewUrl);
                  onRemove(photo.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function PhotosStep({
  template,
  treatmentId,
  photoMetas,
  photos,
  onMetasChange,
  onPhotosChange,
  onBack,
  onNext,
  onSkip,
}: PhotosStepProps) {
  const beforeCount = photos.filter((p) => p.type === "BEFORE").length;
  const afterCount = photos.filter((p) => p.type === "AFTER").length;

  function addPhoto(photo: TreatmentPhoto) {
    onPhotosChange([...photos, photo]);
    onMetasChange([
      ...photoMetas,
      {
        id: photo.id,
        treatmentId: photo.treatmentId,
        type: photo.type,
        createdAt: photo.createdAt,
        hadPreview: true,
      },
    ]);
  }

  function removePhoto(id: string) {
    onPhotosChange(photos.filter((item) => item.id !== id));
    onMetasChange(photoMetas.filter((item) => item.id !== id));
  }

  return (
    <div>
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-text">Before / After</h1>
          <span className="rounded-full bg-[#F3EEEC] px-2.5 py-1 text-xs text-secondary-text">
            選填
          </span>
        </div>
        <p className="mt-2 text-[15px] text-secondary-text">{template.photoGuidelines}</p>
        <p className="mt-2 text-sm text-secondary-text">照片僅供療程追蹤</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-[#F3EEEC] px-3 py-1 text-secondary-text">
          Before {beforeCount}
        </span>
        <span className="rounded-full bg-[#F3EEEC] px-3 py-1 text-secondary-text">
          After {afterCount}
        </span>
      </div>

      <div className="mb-4 rounded-2xl border border-border bg-[#FAF7F5] px-4 py-3 text-sm text-secondary-text">
        Prototype 模式：照片目前只存在本次瀏覽器工作階段，尚未上傳雲端。
      </div>

      <div className="space-y-4">
        <PhotoSection
          eyebrow="BEFORE"
          title="療程前"
          type="BEFORE"
          treatmentId={treatmentId}
          photos={photos}
          onAdd={addPhoto}
          onRemove={removePhoto}
        />
        <PhotoSection
          eyebrow="AFTER"
          title="療程後"
          type="AFTER"
          treatmentId={treatmentId}
          photos={photos}
          onAdd={addPhoto}
          onRemove={removePhoto}
        />
      </div>

      <StepFooter
        onBack={onBack}
        onNext={onNext}
        onSkip={onSkip}
        nextLabel="下一步：專業紀錄"
      />
    </div>
  );
}
