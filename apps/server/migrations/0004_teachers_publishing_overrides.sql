-- Phase 3: teacher workspaces (capability link, D-04), publishing, sharing, overrides.

CREATE TABLE teacher (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Only the SHA-256 of the capability secret is stored (D-04).
  secret_hash  text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE assignment
  ADD COLUMN teacher_id     uuid REFERENCES teacher (id) ON DELETE CASCADE,
  ADD COLUMN status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  ADD COLUMN class_code     text UNIQUE,
  ADD COLUMN share_slug     text UNIQUE,
  -- D-01: students see the labels of criteria they met unless the teacher turns it off.
  ADD COLUMN show_criteria  boolean NOT NULL DEFAULT true,
  ADD COLUMN copied_from    uuid REFERENCES assignment (id) ON DELETE SET NULL,
  ADD COLUMN published_at   timestamptz;
CREATE INDEX assignment_teacher_idx ON assignment (teacher_id);

-- A teacher's correction of one criterion. The latest per criterion wins; code
-- recomputes the total. Kept as labelled data for future evals (P4).
CREATE TABLE override (
  submission_id  uuid NOT NULL REFERENCES submission (id) ON DELETE CASCADE,
  criterion_id   text NOT NULL,
  met            boolean NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, criterion_id)
);

-- Rubrics copied from a colleague's shared assignment (P10) are marked 'template'.
ALTER TABLE rubric DROP CONSTRAINT rubric_source_check;
ALTER TABLE rubric ADD CONSTRAINT rubric_source_check CHECK (source IN ('generated', 'edited', 'sample', 'template'));
