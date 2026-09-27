-- Shared activity feed (Cloudflare D1). Mirrors the table server.mjs creates in Turso.
create table if not exists nearpool_activity (
  hash text primary key,
  account_id text not null,
  pool_id integer not null,
  token_ids text not null,
  symbols text not null,
  decimals text not null,
  amounts text not null,
  shares text not null,
  block_height integer not null,
  timestamp integer not null
);

create index if not exists nearpool_activity_block_height on nearpool_activity (block_height desc);
