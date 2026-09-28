-- Existing entries are additions; new entries may also be permanent LP locks.
alter table nearpool_activity add column kind text not null default 'injection';
