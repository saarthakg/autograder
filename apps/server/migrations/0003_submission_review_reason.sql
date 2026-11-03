-- Why a submission is in the teacher's review queue (P5, P9): the model
-- abstained (illegible), answered invalidly twice, or grading kept failing.
ALTER TABLE submission
  ADD COLUMN review_reason text
  CHECK (review_reason IN ('illegible', 'invalid_output', 'grading_failed'));
