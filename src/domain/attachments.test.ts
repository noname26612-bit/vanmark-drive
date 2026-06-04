import { describe, it, expect } from "vitest";
import { validateUpload, isReportPhotoMissing, MAX_UPLOAD_BYTES } from "./attachments";

describe("validateUpload — приёмка файла", () => {
  it("принимает обычный jpeg", () => {
    expect(validateUpload("image/jpeg", 500_000)).toEqual({ ok: true });
  });
  it("принимает png/webp/heic", () => {
    expect(validateUpload("image/png", 1000).ok).toBe(true);
    expect(validateUpload("image/webp", 1000).ok).toBe(true);
    expect(validateUpload("image/heic", 1000).ok).toBe(true);
  });
  it("отклоняет не-картинку (например, pdf/svg/exe)", () => {
    expect(validateUpload("application/pdf", 1000)).toEqual({ ok: false, code: "BAD_MIME" });
    expect(validateUpload("image/svg+xml", 1000)).toEqual({ ok: false, code: "BAD_MIME" });
    expect(validateUpload("application/octet-stream", 1000)).toEqual({ ok: false, code: "BAD_MIME" });
  });
  it("отклоняет пустой файл", () => {
    expect(validateUpload("image/jpeg", 0)).toEqual({ ok: false, code: "EMPTY" });
  });
  it("отклоняет файл больше лимита (>15 МБ)", () => {
    expect(validateUpload("image/jpeg", MAX_UPLOAD_BYTES + 1)).toEqual({ ok: false, code: "TOO_LARGE" });
    expect(validateUpload("image/jpeg", MAX_UPLOAD_BYTES).ok).toBe(true); // ровно лимит — ок
  });
});

describe("isReportPhotoMissing — гейт фото при DONE", () => {
  it("тип требует фото, фото нет → блок", () => {
    expect(isReportPhotoMissing(true, 0)).toBe(true);
  });
  it("тип требует фото, фото есть → пропуск", () => {
    expect(isReportPhotoMissing(true, 1)).toBe(false);
    expect(isReportPhotoMissing(true, 3)).toBe(false);
  });
  it("тип не требует фото → пропуск даже без фото", () => {
    expect(isReportPhotoMissing(false, 0)).toBe(false);
  });
});
