-- ============================================================
-- Pythagoras Platform — Supabase SQL Schema
-- ============================================================
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Subjects
-- ============================================================
CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  english_name TEXT,
  icon_key TEXT,
  color TEXT,
  available BOOLEAN DEFAULT true,
  "order" INTEGER DEFAULT 0,
  description TEXT,
  schema_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Sections
-- ============================================================
CREATE TABLE IF NOT EXISTS sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  english_name TEXT,
  "order" INTEGER DEFAULT 0,
  available BOOLEAN DEFAULT true,
  schema_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Topics
-- ============================================================
CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id UUID REFERENCES sections(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  "order" INTEGER DEFAULT 0,
  schema_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Packages
-- ============================================================
CREATE TABLE IF NOT EXISTS packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  icon_key TEXT DEFAULT 'package',
  color TEXT DEFAULT '#6366f1',
  status TEXT DEFAULT 'draft',
  version INTEGER DEFAULT 1,
  question_count INTEGER DEFAULT 0,
  resource_count INTEGER DEFAULT 0,
  visible BOOLEAN DEFAULT false,
  "order" INTEGER DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  published_at TIMESTAMPTZ,
  validation_status TEXT DEFAULT 'pending',
  validation_errors INTEGER DEFAULT 0,
  schema_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Questions
-- ============================================================
CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  package_id UUID REFERENCES packages(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  "order" INTEGER DEFAULT 0,
  question_text TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'short-answer',
  answer_text TEXT NOT NULL,
  options TEXT[] DEFAULT '{}',
  correct_option_index INTEGER,
  explanation TEXT,
  difficulty TEXT DEFAULT 'medium',
  tags TEXT[] DEFAULT '{}',
  appearances JSONB DEFAULT '[]',
  resource_ids TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'draft',
  visible BOOLEAN DEFAULT true,
  version INTEGER DEFAULT 1,
  search_text TEXT,
  keywords TEXT[] DEFAULT '{}',
  times_answered INTEGER DEFAULT 0,
  times_correct INTEGER DEFAULT 0,
  schema_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Resources
-- ============================================================
CREATE TABLE IF NOT EXISTS resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL DEFAULT 'image',
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT DEFAULT 0,
  width INTEGER,
  height INTEGER,
  alt_text TEXT,
  caption TEXT,
  shared BOOLEAN DEFAULT false,
  usage_count INTEGER DEFAULT 0,
  schema_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Sources
-- ============================================================
CREATE TABLE IF NOT EXISTS sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  year INTEGER,
  session TEXT,
  notes TEXT,
  schema_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Tags
-- ============================================================
CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Registries
-- ============================================================
CREATE TABLE IF NOT EXISTS registries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  registry TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  english_label TEXT,
  icon_key TEXT,
  color TEXT,
  "order" INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(registry, key)
);

-- ============================================================
-- History
-- ============================================================
CREATE TABLE IF NOT EXISTS history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  changes JSONB,
  user_id TEXT,
  user_name TEXT,
  snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_packages_subject ON packages(subject_id);
CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_updated ON packages(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_questions_package ON questions(package_id);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);
CREATE INDEX IF NOT EXISTS idx_questions_updated ON questions(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sections_subject ON sections(subject_id);
CREATE INDEX IF NOT EXISTS idx_topics_section ON topics(section_id);
CREATE INDEX IF NOT EXISTS idx_topics_subject ON topics(subject_id);

CREATE INDEX IF NOT EXISTS idx_history_entity ON history(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id);

CREATE INDEX IF NOT EXISTS idx_registries_name ON registries(registry);

-- ============================================================
-- RLS (Row Level Security) — open for now, will lock down later
-- ============================================================
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE registries ENABLE ROW LEVEL SECURITY;
ALTER TABLE history ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (service_role bypasses RLS anyway)
-- Use DROP IF EXISTS first so the script is idempotent (safe to re-run)
DROP POLICY IF EXISTS "allow_all_subjects" ON subjects;
CREATE POLICY "allow_all_subjects" ON subjects FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_sections" ON sections;
CREATE POLICY "allow_all_sections" ON sections FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_topics" ON topics;
CREATE POLICY "allow_all_topics" ON topics FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_packages" ON packages;
CREATE POLICY "allow_all_packages" ON packages FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_questions" ON questions;
CREATE POLICY "allow_all_questions" ON questions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_resources" ON resources;
CREATE POLICY "allow_all_resources" ON resources FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_sources" ON sources;
CREATE POLICY "allow_all_sources" ON sources FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_tags" ON tags;
CREATE POLICY "allow_all_tags" ON tags FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_registries" ON registries;
CREATE POLICY "allow_all_registries" ON registries FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_history" ON history;
CREATE POLICY "allow_all_history" ON history FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Auto-update updated_at on row changes
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_subjects_updated ON subjects;
CREATE TRIGGER update_subjects_updated BEFORE UPDATE ON subjects FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_sections_updated ON sections;
CREATE TRIGGER update_sections_updated BEFORE UPDATE ON sections FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_topics_updated ON topics;
CREATE TRIGGER update_topics_updated BEFORE UPDATE ON topics FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_packages_updated ON packages;
CREATE TRIGGER update_packages_updated BEFORE UPDATE ON packages FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_questions_updated ON questions;
CREATE TRIGGER update_questions_updated BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_resources_updated ON resources;
CREATE TRIGGER update_resources_updated BEFORE UPDATE ON resources FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_sources_updated ON sources;
CREATE TRIGGER update_sources_updated BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_tags_updated ON tags;
CREATE TRIGGER update_tags_updated BEFORE UPDATE ON tags FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_registries_updated ON registries;
CREATE TRIGGER update_registries_updated BEFORE UPDATE ON registries FOR EACH ROW EXECUTE FUNCTION update_updated_at();
