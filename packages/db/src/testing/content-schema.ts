/** Minimal schema for the copied Postgres fixture; no product schema crosses this boundary. */
export function pgContentSchemaSql(): string {
  return "CREATE TABLE items (id text PRIMARY KEY, label text NOT NULL); CREATE TABLE entries (id text PRIMARY KEY, item_id text REFERENCES items(id));";
}
