-- Queued cognition, so a restart does not swallow it. The queue used to live
-- only in memory: restarting one tick after midnight lost eight reflections and
-- the day simply had no diaries, silently and with no retry.
CREATE TABLE IF NOT EXISTS cognition_jobs (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       TEXT   NOT NULL,          -- 'scene' | 'reflection'
  tick       BIGINT NOT NULL,
  payload    JSONB  NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cognition_jobs_tick_idx ON cognition_jobs (tick);
