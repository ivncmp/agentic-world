-- The world's history. 001 stores what *is*; this stores what *happened*.
-- Without it a restart leaves the world running with total amnesia: the owner
-- cannot read yesterday's diary, and scenes cannot lean on what came before.

-- Structured, high-volume, queryable. The raw material for an owner briefing
-- ("three days behind on rent, robbed twice this week").
CREATE TABLE IF NOT EXISTS events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tick       BIGINT NOT NULL,
  day        INTEGER NOT NULL,
  kind       TEXT   NOT NULL,
  agent_id   TEXT,
  other_id   TEXT,
  location_id TEXT,
  amount     NUMERIC,
  detail     JSONB
);
CREATE INDEX IF NOT EXISTS events_agent_day_idx ON events (agent_id, day);
CREATE INDEX IF NOT EXISTS events_tick_idx ON events (tick);

-- Conversations, kept whole. The dialogue is the product; a summary would lose
-- the thing the owner actually wants to read.
CREATE TABLE IF NOT EXISTS scenes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tick        BIGINT NOT NULL,
  day         INTEGER NOT NULL,
  agent_a     TEXT   NOT NULL,
  agent_b     TEXT   NOT NULL,
  location_id TEXT   NOT NULL,
  tension     REAL   NOT NULL,
  dialogue    JSONB  NOT NULL,
  outcome     TEXT   NOT NULL,
  transfer    NUMERIC NOT NULL DEFAULT 0,
  cost_usd    NUMERIC NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS scenes_pair_idx ON scenes (agent_a, agent_b);
CREATE INDEX IF NOT EXISTS scenes_day_idx ON scenes (day);

-- Diaries live here rather than in dbrain, though both are narrative text.
-- The owner asks for them by address ("day 5"), not by relevance, and dbrain
-- searches semantically. The diary is for the human; the consolidated memory
-- that dbrain keeps is for the agent. Same reflection, two artefacts, two
-- access patterns.
CREATE TABLE IF NOT EXISTS diaries (
  agent_id  TEXT    NOT NULL,
  day       INTEGER NOT NULL,
  tick      BIGINT  NOT NULL,
  text      TEXT    NOT NULL,
  drift     JSONB   NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (agent_id, day)
);
