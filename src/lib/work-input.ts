// Разбор тела запросов ведомости/справочника работ из untrusted JSON (этап 12).
import type { WorkItemInput, WorkCatalogInput } from "@/domain/work-service";

export function parseWorkItemInput(body: Record<string, unknown>): WorkItemInput {
  const out: WorkItemInput = {};
  if ("catalogItemId" in body) {
    const v = body.catalogItemId;
    if (v === null || typeof v === "string") out.catalogItemId = v;
  }
  if ("name" in body) {
    const v = body.name;
    if (v === null || typeof v === "string") out.name = v;
  }
  if (typeof body.quantity === "number" && Number.isFinite(body.quantity)) {
    out.quantity = Math.trunc(body.quantity);
  }
  return out;
}

export function parseWorkCatalogInput(body: Record<string, unknown>): Partial<WorkCatalogInput> {
  const out: Partial<WorkCatalogInput> = {};
  if (typeof body.name === "string") out.name = body.name;
  if (typeof body.isActive === "boolean") out.isActive = body.isActive;
  if (typeof body.sortOrder === "number") out.sortOrder = Math.trunc(body.sortOrder);
  return out;
}
