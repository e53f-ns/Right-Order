-- ══════════════════════════════════════════════
-- Right Order — Postgres init script
-- ══════════════════════════════════════════════
-- Runs once on first container boot via /docker-entrypoint-initdb.d/
-- Subsequent boots reuse the existing pgdata volume and skip this.

-- Required for pg_stat_statements (also listed in shared_preload_libraries).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Useful for cuid()-style ids and any future UUID work.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Trigram index support — handy for ILIKE searches on email/symbol if added later.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
