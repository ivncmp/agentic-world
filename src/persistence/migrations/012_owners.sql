CREATE TABLE IF NOT EXISTS owners (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  secret_hash TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill owners from existing agents so the FK doesn't break.
-- They get a placeholder hash that no token can match; the real owner
-- must re-register (or the operator seeds a token manually).
INSERT INTO owners (id, secret_hash)
  SELECT DISTINCT owner_id, 'NEEDS_RESET'
  FROM agents
  WHERE owner_id NOT IN (SELECT id FROM owners)
ON CONFLICT DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_agents_owner') THEN
    ALTER TABLE agents ADD CONSTRAINT fk_agents_owner
      FOREIGN KEY (owner_id) REFERENCES owners (id) ON DELETE RESTRICT;
  END IF;
END $$;
