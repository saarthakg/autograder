-- Generic durable job queue (D-12). Claimed with FOR UPDATE SKIP LOCKED;
-- every state change is a single statement so it works behind PgBouncer.
CREATE TABLE job (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Idempotency: a job that would be enqueued twice is enqueued once (P23).
  dedupe_key    text UNIQUE,
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'done', 'dead')),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5,
  run_after     timestamptz NOT NULL DEFAULT now(),
  lease_until   timestamptz,
  claimed_at    timestamptz,
  finished_at   timestamptz,
  last_error    text,
  -- Load-test runs tag every row so they can be measured and deleted (P31).
  run_id        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Claim path: oldest due queued job.
CREATE INDEX job_ready_idx ON job (run_after) WHERE status = 'queued';
-- Sweep path and the global in-flight count.
CREATE INDEX job_lease_idx ON job (lease_until) WHERE status = 'running';
CREATE INDEX job_run_id_idx ON job (run_id) WHERE run_id IS NOT NULL;
