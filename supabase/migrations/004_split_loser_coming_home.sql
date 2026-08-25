update public.lyric_lines
set display_order = display_order + 1000
where song_id = (
  select id
  from public.songs
  where title = 'BIGBANG – LOSER'
  order by created_at desc
  limit 1
)
and display_order >= 11;

update public.lyric_lines
set
  korean = '난 멀리 와버렸어',
  romanization = 'Nan meolli wabeoryeosseo',
  viet_han = 'Nan mơl-li oa-bơ-ri-ót-sơ',
  meaning = 'Tôi đã đi quá xa rồi.',
  start_seconds = 38.09,
  end_seconds = 40.22
where song_id = (
  select id
  from public.songs
  where title = 'BIGBANG – LOSER'
  order by created_at desc
  limit 1
)
and display_order = 10;

update public.lyric_lines
set start_seconds = 41.55
where song_id = (
  select id
  from public.songs
  where title = 'BIGBANG – LOSER'
  order by created_at desc
  limit 1
)
and display_order = 1011;

insert into public.lyric_lines (
  song_id,
  korean,
  viet_han,
  romanization,
  meaning,
  display_order,
  start_seconds,
  end_seconds
)
select
  id,
  'I''m coming home',
  'Ai-m câm-ming hôm',
  'I''m coming home',
  'Tôi đang trở về nhà.',
  11,
  40.22,
  41.55
from public.songs
where title = 'BIGBANG – LOSER'
order by created_at desc
limit 1;

update public.lyric_lines
set display_order = display_order - 999
where song_id = (
  select id
  from public.songs
  where title = 'BIGBANG – LOSER'
  order by created_at desc
  limit 1
)
and display_order >= 1011;
