begin;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'catalog_visibility_reader') then
    create role catalog_visibility_reader nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to catalog_visibility_reader;
grant select on table public.songs, public.youtube_metadata to catalog_visibility_reader;
grant create on schema public to catalog_visibility_reader;
grant catalog_visibility_reader to postgres;

create function public.can_read_imported_song(p_song_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.songs s
    left join public.youtube_metadata m on m.video_id = s.youtube_video_id
    where s.id = p_song_id
      and s.status = 'published'
      and (
        s.source = 'manual'
        or (
          s.source = 'ai'
          and not s.needs_reprocess
          and m.video_id is not null
          and m.expires_at > statement_timestamp()
          and m.is_public
          and m.embeddable
          and not m.is_live
          and m.playable
          and m.duration_seconds between 1 and 480
        )
      )
  )
$$;

alter function public.can_read_imported_song(uuid) owner to catalog_visibility_reader;
revoke all on function public.can_read_imported_song(uuid) from public, anon, authenticated;
grant execute on function public.can_read_imported_song(uuid) to anon;
revoke catalog_visibility_reader from postgres;
revoke create on schema public from catalog_visibility_reader;

drop policy "anon reads published songs" on public.songs;
drop policy "anon reads lines for published songs" on public.lyric_lines;

create policy "anon reads visible songs"
  on public.songs for select to anon
  using (public.can_read_imported_song(id));

create policy "anon reads lines for visible songs"
  on public.lyric_lines for select to anon
  using (public.can_read_imported_song(song_id));

commit;
