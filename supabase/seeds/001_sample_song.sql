-- Optional starter seed for a fresh Supabase project.
-- Run this after supabase/migrations/001_create_catalog.sql.

with inserted_song as (
  insert into public.songs (title, youtube_url, status)
  values (
    'Into the New World',
    'https://www.youtube.com/watch?v=0k2Zzkw_-0I',
    'published'
  )
  returning id
)
insert into public.lyric_lines (
  song_id,
  korean,
  romanization,
  meaning,
  display_order,
  start_seconds,
  end_seconds
)
select
  inserted_song.id,
  sample_line.korean,
  sample_line.romanization,
  sample_line.meaning,
  sample_line.display_order,
  sample_line.start_seconds,
  sample_line.end_seconds
from inserted_song
cross join (
  values
    ('jeon hae julge nae modeun sarangeul', 'Jeon hae julge nae modeun sarangeul', 'I will give you all of my love', 0, 11, 16),
    ('uri hamkke haneun sesangeun deo areumdaul geoya', 'Uri hamkke haneun sesangeun deo areumdaul geoya', 'The world we make together will be more beautiful', 1, 16, 22),
    ('saranghae neol i neukkim idaero', 'Saranghae neol i neukkim idaero', 'I love you just like this feeling', 2, 22, 27),
    ('geuryeowatdeon hemaeimui kkeut', 'Geuryeowatdeon hemaeimui kkeut', 'The end of the wandering we imagined', 3, 27, 33)
) as sample_line(korean, romanization, meaning, display_order, start_seconds, end_seconds);
