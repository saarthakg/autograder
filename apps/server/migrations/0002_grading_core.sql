-- Core grading tables (PLAN §2). Teacher identity and overrides land in Phase 3.

CREATE TABLE assignment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  -- Load-test assignments are graded by the in-process simulator (D-28).
  simulated   boolean NOT NULL DEFAULT false,
  run_id      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE problem (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id           uuid NOT NULL REFERENCES assignment (id) ON DELETE CASCADE,
  position                integer NOT NULL,
  prompt_md               text NOT NULL,
  answer_key              text,
  max_points              integer NOT NULL CHECK (max_points BETWEEN 1 AND 10),
  current_rubric_version  integer NOT NULL DEFAULT 1,
  UNIQUE (assignment_id, position)
);

-- Append-only: every edit is a new version, and grades record which one they used (P3).
CREATE TABLE rubric (
  problem_id          uuid NOT NULL REFERENCES problem (id) ON DELETE CASCADE,
  version             integer NOT NULL,
  items               jsonb NOT NULL,
  reference_solution  text NOT NULL,
  source              text NOT NULL CHECK (source IN ('generated', 'edited', 'sample')),
  model               text,
  prompt_version      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (problem_id, version)
);

CREATE TABLE student (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  uuid NOT NULL REFERENCES assignment (id) ON DELETE CASCADE,
  -- Never sent to the model (P2).
  display_name   text NOT NULL,
  rejoin_code    text NOT NULL,
  token_hash     text NOT NULL UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, rejoin_code)
);

CREATE TABLE submission (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       uuid NOT NULL REFERENCES student (id) ON DELETE CASCADE,
  problem_id       uuid NOT NULL REFERENCES problem (id) ON DELETE CASCADE,
  attempt          integer NOT NULL DEFAULT 1,
  -- Double-taps and retried requests map to one submission (P23).
  idempotency_key  text NOT NULL UNIQUE,
  -- Strokes are the durable record; the PNG is derived and purged once terminal (D-13).
  strokes          jsonb NOT NULL,
  image            bytea,
  status           text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'grading', 'graded', 'needs_review')),
  accepted_at      timestamptz NOT NULL DEFAULT now(),
  graded_at        timestamptz,
  run_id           text,
  UNIQUE (student_id, problem_id, attempt)
);
CREATE INDEX submission_problem_idx ON submission (problem_id);
CREATE INDEX submission_run_id_idx ON submission (run_id) WHERE run_id IS NOT NULL;

CREATE TABLE grade (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id      uuid NOT NULL REFERENCES submission (id) ON DELETE CASCADE,
  rubric_version     integer NOT NULL,
  model              text NOT NULL,
  prompt_version     text NOT NULL,
  transcription      text NOT NULL,
  legible            boolean NOT NULL,
  confidence         text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  verdicts           jsonb NOT NULL,
  -- Computed by code from verdicts x rubric weights, never by the model (P13).
  total_points       integer NOT NULL,
  max_points         integer NOT NULL,
  model_started_at   timestamptz NOT NULL,
  model_finished_at  timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- A job that runs twice writes one grade (P23).
  UNIQUE (submission_id, rubric_version)
);

-- Every model call, including failures: cost, latency, and error rates (D-15).
CREATE TABLE model_call (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose        text NOT NULL CHECK (purpose IN ('grade', 'rubric', 'eval', 'canary')),
  submission_id  uuid REFERENCES submission (id) ON DELETE SET NULL,
  model          text NOT NULL,
  simulated      boolean NOT NULL DEFAULT false,
  outcome        text NOT NULL,
  http_status    integer,
  input_tokens   integer,
  output_tokens  integer,
  cost_usd       numeric(12, 8),
  latency_ms     integer NOT NULL,
  error          text,
  run_id         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_call_created_idx ON model_call (created_at);
