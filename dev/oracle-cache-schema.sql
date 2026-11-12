CREATE TABLE app.oracle_cache (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  expires bigint NOT NULL
);
CREATE INDEX oracle_cache_expires_idx ON app.oracle_cache (expires);