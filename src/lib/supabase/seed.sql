-- ============================================================
-- Pythagoras Platform — Default Seed Data (Registries + Subjects)
-- ============================================================
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- AFTER running schema.sql
-- ============================================================
-- This script is idempotent (safe to re-run). It uses ON CONFLICT
-- to skip entries that already exist.
-- ============================================================

-- ============================================================
-- 1. Registries (9 registries × ~5-12 entries each)
-- ============================================================

-- Use a CTE to insert all entries in one shot, ignoring conflicts.
-- The UNIQUE(registry, key) constraint handles deduplication.

INSERT INTO registries (registry, key, label, english_label, icon_key, color, "order", active, metadata)
VALUES
  -- ---- Subjects Registry (mapped 1:1 with subjects table) ----
  ('subjects', 'math',        'الرياضيات',       'Mathematics',         'calculator',  '#3b82f6', 1,  true, '{}'),
  ('subjects', 'physics',     'الفيزياء',         'Physics',             'atom',        '#ef4444', 2,  true, '{}'),
  ('subjects', 'chemistry',   'الكيمياء',         'Chemistry',           'flask',       '#10b981', 3,  true, '{}'),
  ('subjects', 'biology',     'الأحياء',          'Biology',             'dna',         '#22c55e', 4,  true, '{}'),
  ('subjects', 'arabic',      'اللغة العربية',    'Arabic Language',     'book',        '#a855f7', 5,  true, '{}'),
  ('subjects', 'english',     'اللغة الإنكليزية', 'English Language',    'globe',       '#0ea5e9', 6,  true, '{}'),
  ('subjects', 'french',      'اللغة الفرنسية',   'French Language',     'globe-2',     '#6366f1', 7,  true, '{}'),
  ('subjects', 'history',     'التاريخ',          'History',             'scroll',      '#d97706', 8,  true, '{}'),
  ('subjects', 'geography',   'الجغرافيا',        'Geography',           'map',         '#f59e0b', 9,  true, '{}'),
  ('subjects', 'philosophy',  'الفلسفة',          'Philosophy',          'brain',       '#8b5cf6', 10, true, '{}'),
  ('subjects', 'civics',      'التربية المدنية',  'Civics',              'scale',       '#0891b2', 11, true, '{}'),
  ('subjects', 'economics',   'الاقتصاد',         'Economics',           'trending-up', '#059669', 12, true, '{}'),

  -- ---- Question Types ----
  ('question-types', 'mcq',           'اختيار من متعدد',           'Multiple Choice',       'check-circle', '#3b82f6', 1,  true, '{}'),
  ('question-types', 'fill-blank',    'تعبئة الفراغ',              'Fill in the Blank',     'edit-3',        '#10b981', 2,  true, '{}'),
  ('question-types', 'true-false',    'صح أو خطأ',                 'True / False',          'check-square',  '#f59e0b', 3,  true, '{}'),
  ('question-types', 'short-answer',  'إجابة قصيرة',               'Short Answer',          'message-square','#8b5cf6', 4,  true, '{}'),
  ('question-types', 'long-answer',   'إجابة طويلة',               'Long Answer',           'align-left',    '#ec4899', 5,  true, '{}'),
  ('question-types', 'essay',         'سؤال مقالي',                'Essay',                 'file-text',     '#d97706', 6,  true, '{}'),
  ('question-types', 'matching',      'تطابق',                     'Matching',              'shuffle',       '#06b6d4', 7,  true, '{}'),
  ('question-types', 'ordering',      'ترتيب',                     'Ordering',              'list-ordered',  '#6366f1', 8,  true, '{}'),
  ('question-types', 'diagram',       'رسم بياني',                 'Diagram',               'image',         '#84cc16', 9,  true, '{}'),
  ('question-types', 'custom',        'سؤال مخصص',                 'Custom',                'settings',      '#64748b', 10, true, '{}'),

  -- ---- Sources (where a question appeared) ----
  ('sources', 'ministerial',    'امتحان وزاري',           'Ministerial Exam',     'file-text',  '#dc2626', 1, true, '{}'),
  ('sources', 'educational-tv', 'التلفزة التعليمية',       'Educational TV',       'tv',         '#7c3aed', 2, true, '{}'),
  ('sources', 'chapter-end',    'نهاية الفصل',            'Chapter End',          'book-closed','#0891b2', 3, true, '{}'),
  ('sources', 'discussion',     'أسئلة النقاش',           'Discussion Questions', 'message',    '#059669', 4, true, '{}'),
  ('sources', 'enrichment',     'أسئلة إثرائية',          'Enrichment',           'sparkles',   '#db2777', 5, true, '{}'),
  ('sources', 'custom',         'مصدر مخصص',              'Custom',               'settings',   '#64748b', 6, true, '{}'),

  -- ---- Difficulty Levels ----
  ('difficulty', 'easy',   'سهل',   'Easy',   'leaf',     '#22c55e', 1, true, '{}'),
  ('difficulty', 'medium', 'متوسط', 'Medium', 'flame',    '#f59e0b', 2, true, '{}'),
  ('difficulty', 'hard',   'صعب',   'Hard',   'flame',    '#ef4444', 3, true, '{}'),
  ('difficulty', 'expert', 'خبير',  'Expert', 'mountain', '#7c2d12', 4, true, '{}'),

  -- ---- Resource Types ----
  ('resource-types', 'image',       'صورة',           'Image',       'image',         '#3b82f6', 1,  true, '{}'),
  ('resource-types', 'drawing',     'رسم توضيحي',     'Drawing',     'pen-tool',      '#8b5cf6', 2,  true, '{}'),
  ('resource-types', 'svg',         'رسمة SVG',       'SVG',         'code',          '#06b6d4', 3,  true, '{}'),
  ('resource-types', 'table',       'جدول',           'Table',       'table',         '#10b981', 4,  true, '{}'),
  ('resource-types', 'audio',       'صوت',            'Audio',       'volume-2',      '#f59e0b', 5,  true, '{}'),
  ('resource-types', 'video',       'فيديو',          'Video',       'video',         '#ec4899', 6,  true, '{}'),
  ('resource-types', 'pdf',         'ملف PDF',        'PDF',         'file',          '#dc2626', 7,  true, '{}'),
  ('resource-types', 'animation',   'حركة',           'Animation',   'play-circle',   '#7c3aed', 8,  true, '{}'),
  ('resource-types', 'interactive', 'تفاعلي',         'Interactive', 'mouse-pointer', '#0891b2', 9,  true, '{}'),
  ('resource-types', 'custom',      'مورد مخصص',      'Custom',      'settings',      '#64748b', 10, true, '{}'),

  -- ---- Branches (Scientific / Literary) ----
  ('branches', 'scientific', 'علمي',   'Scientific', 'flask-conical', '#3b82f6', 1, true, '{}'),
  ('branches', 'literary',   'أدبي',   'Literary',   'book-open',     '#a855f7', 2, true, '{}'),

  -- ---- Exam Sessions ----
  ('exam-sessions', 'first',  'الدورة الأولى',  'First Session',  'calendar', '#3b82f6', 1, true, '{}'),
  ('exam-sessions', 'second', 'الدورة الثانية', 'Second Session', 'calendar', '#ef4444', 2, true, '{}'),
  ('exam-sessions', 'makeup', 'دورة استدراكية', 'Makeup Session', 'refresh',  '#f59e0b', 3, true, '{}'),

  -- ---- Languages ----
  ('languages', 'ar', 'العربية', 'Arabic',  'globe',    '#10b981', 1, true, '{}'),
  ('languages', 'en', 'الإنكليزية', 'English', 'globe-2', '#3b82f6', 2, true, '{}'),
  ('languages', 'fr', 'الفرنسية',  'French',  'globe-2',  '#6366f1', 3, true, '{}'),

  -- ---- Package Status ----
  ('package-status', 'draft',     'مسودة',          'Draft',      'edit-3',       '#64748b', 1, true, '{}'),
  ('package-status', 'review',    'قيد المراجعة',   'In Review',  'eye',          '#f59e0b', 2, true, '{}'),
  ('package-status', 'ready',     'جاهز للنشر',     'Ready',      'check-circle', '#10b981', 3, true, '{}'),
  ('package-status', 'published', 'منشور',          'Published',  'rocket',       '#3b82f6', 4, true, '{}'),
  ('package-status', 'archived',  'مؤرشف',          'Archived',   'archive',      '#6b7280', 5, true, '{}'),
  ('package-status', 'hidden',    'مخفي',           'Hidden',     'eye-off',      '#9ca3af', 6, true, '{}')
ON CONFLICT (registry, key) DO NOTHING;

-- ============================================================
-- 2. Subjects (mirror the registry entries above)
-- ============================================================
-- These are the actual subject records shown in the UI. The
-- registry entries above are used to drive dropdowns and filters.

INSERT INTO subjects (name, english_name, icon_key, color, available, "order", description, schema_version)
VALUES
  ('الرياضيات',       'Mathematics',         'calculator',  '#3b82f6', true, 1,  'الرياضيات للصف السادس الإعدادي — تشمل الجبر، الهندسة، حساب المثلثات، والتفاضل.', 1),
  ('الفيزياء',         'Physics',             'atom',        '#ef4444', true, 2,  'الفيزياء للصف السادس الإعدادي — الميكانيك، الكهرباء، المغناطيسية، والبصريات.', 1),
  ('الكيمياء',         'Chemistry',           'flask',       '#10b981', true, 3,  'الكيمياء للصف السادس الإعدادي — البنية الذرية، الروابط، التفاعلات، والكيمياء العضوية.', 1),
  ('الأحياء',          'Biology',             'dna',         '#22c55e', true, 4,  'الأحياء للصف السادس الإعدادي — الخلية، الوراثة، التطور، والأجهزة الحيوية.', 1),
  ('اللغة العربية',    'Arabic Language',     'book',        '#a855f7', true, 5,  'اللغة العربية للصف السادس الإعدادي — النحو، البلاغة، الأدب، والنصوص.', 1),
  ('اللغة الإنكليزية', 'English Language',    'globe',       '#0ea5e9', true, 6,  'اللغة الإنكليزية للصف السادس الإعدادي — القواعد، المفردات، القراءة، والكتابة.', 1),
  ('اللغة الفرنسية',   'French Language',     'globe-2',     '#6366f1', true, 7,  'اللغة الفرنسية للصف السادس الإعدادي — القواعد، المفردات، والنصوص.', 1),
  ('التاريخ',          'History',             'scroll',      '#d97706', true, 8,  'التاريخ للصف السادس الإعدادي — التاريخ القديم، الوسيط، والحديث.', 1),
  ('الجغرافيا',        'Geography',           'map',         '#f59e0b', true, 9,  'الجغرافيا للصف السادس الإعدادي — الجغرافيا الطبيعية والبشرية والاقتصادية.', 1),
  ('الفلسفة',          'Philosophy',          'brain',       '#8b5cf6', true, 10, 'الفلسفة للصف السادس الإعدادي — المدارس الفلسفية، المنطق، والأخلاق.', 1),
  ('التربية المدنية',  'Civics',              'scale',       '#0891b2', true, 11, 'التربية المدنية للصف السادس الإعدادي — الحقوق، الواجبات، والمؤسسات.', 1),
  ('الاقتصاد',         'Economics',           'trending-up', '#059669', true, 12, 'الاقتصاد للصف السادس الإعدادي — المبادئ، النظم الاقتصادية، والمالية.', 1)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Default Tags (a few common ones to start with)
-- ============================================================

INSERT INTO tags (name, color, usage_count)
VALUES
  ('مراجعة شاملة',     '#3b82f6', 0),
  ('امتحان وزاري',     '#ef4444', 0),
  ('أسئلة سهلة',       '#22c55e', 0),
  ('أسئلة صعبة',       '#dc2626', 0),
  ('مهم',              '#f59e0b', 0),
  ('تدريبي',           '#8b5cf6', 0),
  ('نظري',             '#06b6d4', 0),
  ('عملي',             '#10b981', 0),
  ('وظيفة',            '#ec4899', 0),
  ('واجب منزلي',       '#7c3aed', 0)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Verification
-- ============================================================
-- Quick counts so you can verify the seed ran correctly:
SELECT 'registries' AS table_name, COUNT(*) AS row_count FROM registries
UNION ALL SELECT 'subjects', COUNT(*) FROM subjects
UNION ALL SELECT 'tags', COUNT(*) FROM tags;
