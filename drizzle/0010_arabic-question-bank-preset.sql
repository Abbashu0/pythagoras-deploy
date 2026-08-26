-- Product-owned Arabic Question Bank topology. This seeds only an absent layout
-- and only when a local OWNER already exists; first-run bootstrap handles new DBs.
INSERT INTO `material_question_bank_layouts` (`material_id`,`root_presentation`,`created_at`,`updated_at`,`updated_by`,`revision`)
SELECT m.`id`, 'CARDS', 1787760000000, 1787760000000, u.`id`, 1
FROM `canonical_materials` m
JOIN `admin_users` u ON u.`role` = 'OWNER' AND u.`enabled` = 1
WHERE m.`subject_key` = 'arabic'
  AND NOT EXISTS (SELECT 1 FROM `material_question_bank_layouts` l WHERE l.`material_id` = m.`id`)
ORDER BY u.`created_at`, u.`id`
LIMIT 1;
--> statement-breakpoint
INSERT INTO `material_question_bank_nodes` (`id`,`material_id`,`node_key`,`label`,`node_type`,`parent_id`,`display_order`,`group_presentation`,`package_id`,`target_mode`,`taxonomy_node_id`,`include_descendants`,`enabled`)
SELECT p.`id`, l.`material_id`, p.`node_key`, p.`label`, p.`node_type`, p.`parent_id`, p.`display_order`, p.`group_presentation`, NULL, p.`target_mode`, NULL, NULL, 1
FROM `material_question_bank_layouts` l
JOIN `canonical_materials` m ON m.`id` = l.`material_id`
JOIN (
  SELECT '0195a100-0001-7000-8000-000000000001' AS `id`, 'arabic-literature' AS `node_key`, 'الأدب' AS `label`, 'BANK' AS `node_type`, NULL AS `parent_id`, 1 AS `display_order`, NULL AS `group_presentation`, 'ALL_PACKAGE_QUESTIONS' AS `target_mode`
  UNION ALL SELECT '0195a100-0002-7000-8000-000000000002','arabic-grammar','القواعد','GROUP',NULL,2,'SWITCHER',NULL
  UNION ALL SELECT '0195a100-0011-7000-8000-000000000011','arabic-grammar-istifham','الاستفهام','BANK','0195a100-0002-7000-8000-000000000002',1,NULL,'ALL_PACKAGE_QUESTIONS'
  UNION ALL SELECT '0195a100-0012-7000-8000-000000000012','arabic-grammar-nafi','النفي','BANK','0195a100-0002-7000-8000-000000000002',2,NULL,'ALL_PACKAGE_QUESTIONS'
  UNION ALL SELECT '0195a100-0013-7000-8000-000000000013','arabic-grammar-taqdim-takhir','التقديم والتأخير','BANK','0195a100-0002-7000-8000-000000000002',3,NULL,'ALL_PACKAGE_QUESTIONS'
  UNION ALL SELECT '0195a100-0014-7000-8000-000000000014','arabic-grammar-tawkeed','التوكيد','BANK','0195a100-0002-7000-8000-000000000002',4,NULL,'ALL_PACKAGE_QUESTIONS'
  UNION ALL SELECT '0195a100-0015-7000-8000-000000000015','arabic-grammar-nidaa','النداء','BANK','0195a100-0002-7000-8000-000000000002',5,NULL,'ALL_PACKAGE_QUESTIONS'
  UNION ALL SELECT '0195a100-0016-7000-8000-000000000016','arabic-grammar-taajjub','التعجب','BANK','0195a100-0002-7000-8000-000000000002',6,NULL,'ALL_PACKAGE_QUESTIONS'
  UNION ALL SELECT '0195a100-0017-7000-8000-000000000017','arabic-grammar-madh-dham','المدح والذم','BANK','0195a100-0002-7000-8000-000000000002',7,NULL,'ALL_PACKAGE_QUESTIONS'
  UNION ALL SELECT '0195a100-0018-7000-8000-000000000018','arabic-grammar-tamanni-tarajji','التمني والترجي','BANK','0195a100-0002-7000-8000-000000000002',8,NULL,'ALL_PACKAGE_QUESTIONS'
  UNION ALL SELECT '0195a100-0019-7000-8000-000000000019','arabic-grammar-ard-tahdid','العرض والتحضيض','BANK','0195a100-0002-7000-8000-000000000002',9,NULL,'ALL_PACKAGE_QUESTIONS'
) p
WHERE m.`subject_key` = 'arabic'
  AND l.`created_at` = 1787760000000
  AND l.`updated_at` = 1787760000000
  AND l.`revision` = 1;
