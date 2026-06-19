// Разбор тела запросов ведомости/справочника работ из untrusted JSON (этап 12–13).
import type { WorkItemInput, WorkCatalogInput, PricingInput } from "@/domain/work-service";

export function parsePricingInput(body: Record<string, unknown>): PricingInput {
  const items: { id: string; price: number }[] = [];
  if (Array.isArray(body.items)) {
    for (const raw of body.items) {
      if (raw && typeof raw === "object") {
        const r = raw as Record<string, unknown>;
        if (typeof r.id === "string" && typeof r.price === "number" && Number.isFinite(r.price)) {
          items.push({ id: r.id, price: Math.trunc(r.price) });
        }
      }
    }
  }
  return { items };
}

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
  // Цена-подсказка: число (₽) или null (очистить). Прочее (undefined/строка) — поле не трогаем.
  if ("defaultPrice" in body) {
    const v = body.defaultPrice;
    if (v === null) out.defaultPrice = null;
    else if (typeof v === "number" && Number.isFinite(v)) out.defaultPrice = Math.trunc(v);
  }
  return out;
}
