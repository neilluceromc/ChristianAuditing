-- Append-only enforcement: UPDATE/DELETE on audit entries and note entries
-- raise at the database level. Inserts are unaffected.

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_entry_append_only
  BEFORE UPDATE OR DELETE ON "AuditEntry"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER note_entry_append_only
  BEFORE UPDATE OR DELETE ON "NoteEntry"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
