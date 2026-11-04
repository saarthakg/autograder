-- Which OpenRouter provider served a call (D-30): with provider.order and a
-- fallback model, the model id alone no longer says where a grade came from.
ALTER TABLE grade ADD COLUMN provider text;
ALTER TABLE model_call ADD COLUMN provider text;
