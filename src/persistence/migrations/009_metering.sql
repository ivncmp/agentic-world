CREATE TABLE IF NOT EXISTS llm_calls (
  id         SERIAL PRIMARY KEY,
  tick       INT NOT NULL,
  day        INT NOT NULL,
  agent_id   TEXT NOT NULL,
  purpose    TEXT NOT NULL,
  provider   TEXT NOT NULL,
  model      TEXT,
  input_tokens  INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cost_usd   REAL NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_llm_calls_agent ON llm_calls (agent_id);
CREATE INDEX idx_llm_calls_day   ON llm_calls (day);
