import type { ContentDatabase } from "../content/database";
import { getAssetService } from "../assets";
import { toLocalAdminAssetView, type LocalAdminAssetView } from "../assets/admin-view";
import type { CanonicalMaterial } from "./contracts";

export interface LocalAdminMaterialView {
  id: string;
  subjectKey: string;
  label: string;
  englishTitle: string;
  iconKey: string;
  gradient: string;
  available: boolean;
  position: number;
  asset: LocalAdminAssetView | null;
  offsetX: number;
  offsetY: number;
  scale: number;
  stats: { packages: number; questions: number };
  updatedAt: number;
  revision: number;
}

export async function toLocalAdminMaterialView(
  database: ContentDatabase,
  material: CanonicalMaterial,
): Promise<LocalAdminMaterialView> {
  const assets = getAssetService();
  const assetRecord = material.assetId
    ? assets.getByIdWithCreator(material.assetId)
    : null;
  const asset = assetRecord
    ? await toLocalAdminAssetView(database, assets, assetRecord)
    : null;
  const counts = database.client
    .prepare(
      `select count(distinct p.id) as package_count,
              count(q.id) as question_count
         from question_packages p
         left join questions q on q.package_id = p.id
        where p.subject_key = ?`,
    )
    .get(material.subjectKey) as { package_count: number; question_count: number };

  return {
    id: material.id,
    subjectKey: material.subjectKey,
    label: material.label,
    englishTitle: material.englishTitle,
    iconKey: material.iconKey,
    gradient: material.gradient,
    available: material.available,
    position: material.displayOrder,
    asset,
    offsetX: material.offsetX,
    offsetY: material.offsetY,
    scale: material.scale,
    stats: {
      packages: Number(counts.package_count ?? 0),
      questions: Number(counts.question_count ?? 0),
    },
    updatedAt: material.updatedAt,
    revision: material.revision,
  };
}
