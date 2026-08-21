-- World state. Narrative memory lives in dbrain, not here: this table holds
-- what the tick loop reads and writes every five minutes, which must be local.
--
-- Nested structures are JSONB rather than normalised columns on purpose — the
-- agent schema is still moving, and a migration per field while the design
-- settles would cost more than it buys. Anything the gate or a query needs to
-- filter on gets a real column.

CREATE TABLE IF NOT EXISTS world (
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tick          BIGINT      NOT NULL DEFAULT 0,
  seed          INTEGER     NOT NULL,
  city          JSONB       NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations (
  id            TEXT PRIMARY KEY,
  kind          TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  district      TEXT    NOT NULL,
  x             INTEGER NOT NULL,
  y             INTEGER NOT NULL,
  resident_id   TEXT,
  -- NULL means the location is not a workplace at all, which is different
  -- from a workplace with no vacancies left.
  openings      INTEGER
);

CREATE TABLE IF NOT EXISTS agents (
  id                  TEXT PRIMARY KEY,
  name                TEXT    NOT NULL,
  owner_id            TEXT    NOT NULL,
  occupation          TEXT    NOT NULL,
  money               NUMERIC NOT NULL,
  location_id         TEXT    NOT NULL,
  last_theft_tick     BIGINT,
  last_reflection_day INTEGER NOT NULL DEFAULT 0,
  values_json         JSONB   NOT NULL,
  vices               JSONB   NOT NULL,
  needs               JSONB   NOT NULL,
  job                 JSONB,
  housing             JSONB   NOT NULL,
  activity            JSONB,
  goals               JSONB   NOT NULL,
  constraints_json    JSONB   NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_owner_idx ON agents (owner_id);
CREATE INDEX IF NOT EXISTS agents_location_idx ON agents (location_id);

-- Denormalised relationship cache. dbrain holds the narrative that explains
-- these numbers; on divergence dbrain wins. Keyed by the sorted pair so a
-- relationship has exactly one row however it is looked up.
CREATE TABLE IF NOT EXISTS relationships (
  pair_key              TEXT PRIMARY KEY,
  agent_a               TEXT NOT NULL,
  agent_b               TEXT NOT NULL,
  affection             REAL NOT NULL DEFAULT 0,
  trust                 REAL NOT NULL DEFAULT 0,
  debt                  NUMERIC NOT NULL DEFAULT 0,
  last_interaction_tick BIGINT
);

-- Counters that reset at the day rollover. Persisted so a restart mid-day does
-- not hand every pair a fresh conversation budget.
CREATE TABLE IF NOT EXISTS daily_counters (
  scope  TEXT    NOT NULL,   -- 'scene_agent' | 'scene_pair' | 'passing_pair' | 'notable'
  key    TEXT    NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key)
);
