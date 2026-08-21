-- Bad blood, separate from debt. A theft used to be written into `debt`, which
-- made every robbery look like a loan and every conversation a collection call.
ALTER TABLE relationships ADD COLUMN IF NOT EXISTS grievance REAL NOT NULL DEFAULT 0;
-- Existing rows carry stolen money in `debt`. There is no way to tell which of
-- those were thefts, so the safe move is to leave the numbers and let them
-- settle or decay naturally rather than guess and rewrite history.
