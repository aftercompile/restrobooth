-- Custom SQL migration file, put your code below! --

-- docs/ERD.md §5, docs/DOMAIN.md §6.3. Two terminals can never be issued
-- overlapping number ranges — enforced by Postgres, not application code.
-- Needs btree_gist for the `=` comparator on uuid inside a GiST exclusion.
create extension if not exists btree_gist;

alter table invoice_number_blocks
  add constraint invoice_number_blocks_no_overlap
  exclude using gist (
    invoice_series_id with =,
    int8range(start_seq, end_seq, '[]') with &&
  );
