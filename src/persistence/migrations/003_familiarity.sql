-- Familiarity: co-located ticks. Its own route to having something to say,
-- because affection alone grows too slowly for warmth to ever reach the gate.
ALTER TABLE relationships ADD COLUMN IF NOT EXISTS encounters INTEGER NOT NULL DEFAULT 0;
