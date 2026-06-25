-- ── CBA workbench corpus ───────────────────────────────────────────────────
create table if not exists cba_documents (
  id             text primary key,
  title          text not null,
  source_url     text not null,
  effective_date date not null,
  season_label   text not null,
  page_count     int not null
);

alter table cba_articles
  add column if not exists document_id text references cba_documents(id) on delete cascade,
  add column if not exists article text,
  add column if not exists section text,
  add column if not exists section_number text,
  add column if not exists page_start int,
  add column if not exists page_end int,
  add column if not exists sort_key int not null default 0,
  add column if not exists aliases text[] not null default '{}',
  add column if not exists source_url text;

create index if not exists idx_cba_articles_document_sort
  on cba_articles(document_id, sort_key);

create index if not exists idx_cba_articles_aliases
  on cba_articles using gin(aliases);

create table if not exists cba_chunks (
  id            text primary key,
  article_id    text not null references cba_articles(id) on delete cascade,
  chunk_index   int not null,
  body          text not null,
  page_start    int,
  page_end      int,
  search_vector tsvector generated always as (to_tsvector('english', body)) stored
);

create unique index if not exists idx_cba_chunks_article_index
  on cba_chunks(article_id, chunk_index);

create index if not exists idx_cba_chunks_article
  on cba_chunks(article_id);

create index if not exists idx_cba_chunks_search
  on cba_chunks using gin(search_vector);
