-- Load-test runs create their own teacher; tag it so the run's cleanup removes it (D-28).
ALTER TABLE teacher ADD COLUMN run_id text;
CREATE INDEX teacher_run_id_idx ON teacher (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX assignment_run_id_idx ON assignment (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX model_call_run_id_idx ON model_call (run_id) WHERE run_id IS NOT NULL;
