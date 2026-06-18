import { listAllWorkCatalog } from "@/domain/work-service";
import { WorkCatalogClient } from "./work-catalog-client";

export const dynamic = "force-dynamic";

export default async function WorkCatalogPage() {
  const items = await listAllWorkCatalog();
  return <WorkCatalogClient initial={items} />;
}
