-- What students see after grading (D-01, amended 2026-11-04): score only,
-- score + met criteria (default), or score + met + "Not yet" criteria.
-- Expand-only: show_criteria stays for the revision still serving during a
-- deploy and is no longer read; a later migration can drop it.
ALTER TABLE assignment ADD COLUMN student_view text NOT NULL DEFAULT 'met'
  CHECK (student_view IN ('score', 'met', 'met_not_yet'));
UPDATE assignment SET student_view = 'score' WHERE show_criteria = false;
