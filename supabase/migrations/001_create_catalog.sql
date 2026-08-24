-- Anonymous SELECT returns published songs only.
-- Anonymous SELECT cannot insert, update, or delete either table.
-- Lyrics are readable only when their parent song is published.
-- start_seconds is non-negative and end_seconds is greater than start_seconds.

create table public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) > 0),
  youtube_url text not null check (char_length(trim(youtube_url)) > 0),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lyric_lines (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs(id) on delete cascade,
  korean text not null check (char_length(trim(korean)) > 0),
  romanization text,
  meaning text,
  display_order integer not null check (display_order >= 0),
  start_seconds numeric not null check (start_seconds >= 0),
  end_seconds numeric not null check (end_seconds > start_seconds),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (song_id, display_order)
);

create index lyric_lines_song_id_display_order_idx
  on public.lyric_lines (song_id, display_order);

alter table public.songs enable row level security;
alter table public.lyric_lines enable row level security;

create policy "anon reads published songs"
  on public.songs for select to anon
  using (status = 'published');

create policy "anon reads lines for published songs"
  on public.lyric_lines for select to anon
  using (
    exists (
      select 1
      from public.songs
      where songs.id = lyric_lines.song_id
        and songs.status = 'published'
    )
  );
