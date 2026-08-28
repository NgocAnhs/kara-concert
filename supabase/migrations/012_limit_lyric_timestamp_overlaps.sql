create or replace function public.update_lyric_timestamps(p_song_id uuid, p_lines jsonb)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare supplied_count integer; stored_count integer;
begin
  if jsonb_typeof(p_lines) <> 'array' then return false; end if;
  perform 1 from public.songs where id = p_song_id for update;
  if not found then return false; end if;
  perform 1 from public.lyric_lines where song_id = p_song_id for update;
  select count(*), count(distinct id) into supplied_count, stored_count from jsonb_to_recordset(p_lines) as supplied(id uuid, start_seconds numeric, end_seconds numeric);
  if supplied_count <> stored_count then return false; end if;
  select count(*) into stored_count from public.lyric_lines where song_id = p_song_id;
  if supplied_count <> stored_count or supplied_count = 0 then return false; end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) as supplied(id uuid, start_seconds numeric, end_seconds numeric) where id is null or start_seconds is null or end_seconds is null or start_seconds < 0 or end_seconds <= start_seconds)
    or exists (select 1 from jsonb_to_recordset(p_lines) as supplied(id uuid, start_seconds numeric, end_seconds numeric) where not exists (select 1 from public.lyric_lines line where line.id = supplied.id and line.song_id = p_song_id))
    or exists (select 1 from jsonb_to_recordset(p_lines) as supplied(id uuid, start_seconds numeric, end_seconds numeric) group by start_seconds having count(*) > 1)
  then return false; end if;

  if exists (
    with supplied as (
      select line.display_order, input.start_seconds, input.end_seconds
      from jsonb_to_recordset(p_lines) as input(id uuid, start_seconds numeric, end_seconds numeric)
      join public.lyric_lines line on line.id = input.id and line.song_id = p_song_id
    ), ranked as (
      select *, row_number() over (order by display_order) as lyric_position
      from supplied
    )
    select 1
    from ranked earlier
    join ranked later on earlier.lyric_position < later.lyric_position
    where (
      later.lyric_position = earlier.lyric_position + 1
      and later.start_seconds < earlier.end_seconds - 1
    ) or (
      later.lyric_position > earlier.lyric_position + 1
      and later.start_seconds < earlier.end_seconds
      and earlier.start_seconds < later.end_seconds
    )
  ) then return false; end if;

  update public.lyric_lines line set start_seconds = supplied.start_seconds, end_seconds = supplied.end_seconds, updated_at = clock_timestamp() from jsonb_to_recordset(p_lines) as supplied(id uuid, start_seconds numeric, end_seconds numeric) where line.id = supplied.id and line.song_id = p_song_id;
  return true;
end;
$$;
