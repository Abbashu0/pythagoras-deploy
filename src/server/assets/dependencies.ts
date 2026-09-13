import type { ContentDatabase } from "../content/database";
import type { AssetDependent } from "./contracts";

type AssetDependentRow = {
  id: string;
  type: string;
  name: string;
  technicalId: string;
  href: string | null;
};

/**
 * Reads only the relational owners of an Asset. Content text, storage keys and
 * filesystem paths never enter this dependency DTO.
 */
export function getAssetDependents(
  database: ContentDatabase,
  assetId: string,
): AssetDependent[] {
  const rows = database.client
    .prepare(
      `select 'بانر' as type, 'banner:' || id as id,
              coalesce(nullif(trim(title), ''), 'بانر بدون اسم') as name,
              id as technicalId, '/admin/ads/banners' as href
         from canonical_banners where asset_id = ?
       union all
       select 'مادة', 'material:' || id,
              coalesce(nullif(trim(label), ''), 'مادة بدون اسم'),
              id, null
         from canonical_materials where asset_id = ?
       union all
       select 'مصدر معرفة', 'knowledge-source-revision:' || id,
              display_name, id, null
         from ai_knowledge_source_revisions where source_asset_id = ?
       union all
       select 'حزمة معرفة', 'knowledge-package-asset:' || kpa.package_revision_id || ':' || kpa.asset_ref,
              kpr.title, kpa.asset_ref, null
         from ai_knowledge_package_assets kpa
         inner join ai_knowledge_package_revisions kpr on kpr.id = kpa.package_revision_id
        where kpa.asset_id = ?
       union all
       select 'ترحيل قديم', 'legacy-migration-asset:' || id,
              legacy_reference, id, null
         from legacy_migration_assets where asset_id = ?
       union all
       select 'حزمة أسئلة', 'question-package:' || id,
              title, id, null
         from question_packages where source_asset_id = ?
       union all
       select 'ملف حزمة أسئلة', 'question-package-asset:' || package_id || ':' || asset_ref,
              asset_ref, asset_ref, null
         from question_package_asset_bindings where asset_id = ?
        order by type, name, id`,
    )
    .all(
      assetId,
      assetId,
      assetId,
      assetId,
      assetId,
      assetId,
      assetId,
    ) as AssetDependentRow[];

  return rows.map(({ id, type, name, technicalId, href }) => ({
    id,
    type,
    name,
    technicalId,
    ...(href ? { href } : {}),
  }));
}
