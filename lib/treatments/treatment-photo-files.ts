/** Browser-only file bytes. They are never written into the treatment draft. */

const files = new Map<string, File>();

export function rememberTreatmentPhotoFile(id: string, file: File): void {
  files.set(id, file);
}

export function forgetTreatmentPhotoFile(id: string): void {
  files.delete(id);
}

export function treatmentPhotoFile(id: string): File | null {
  return files.get(id) ?? null;
}

export async function treatmentPhotoBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
