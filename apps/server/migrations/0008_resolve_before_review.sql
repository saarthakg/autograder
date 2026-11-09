-- Work the grader still can't read after escalation goes back to the student once
-- ('redo', "please rewrite it more clearly") instead of straight to the teacher.
ALTER TABLE submission DROP CONSTRAINT submission_status_check;
ALTER TABLE submission ADD CONSTRAINT submission_status_check
  CHECK (status IN ('queued', 'grading', 'graded', 'needs_review', 'redo'));

-- Students see what they got right and what isn't there yet, unless the teacher chooses otherwise.
ALTER TABLE assignment ALTER COLUMN student_view SET DEFAULT 'met_not_yet';
