# K-pop Concert Practice Web — Design

## Goal

Provide a public, browser-based practice tool for learning songs from a curated concert set list. Visitors can play an embedded YouTube video, navigate lyrics by line, and repeatedly practice any selected line or contiguous range. The site owner curates all song data.

## Scope

- No visitor accounts, visitor-created content, collaboration, song discovery, or server-side audio storage.
- The admin owns and enters the song list, lyrics, pronunciation aids, translations, and timings.
- YouTube is used only through an embedded player; the application does not download or store media.
- Public visitors have read-only access only. Admin data entry happens in the Supabase Dashboard, not in the public site.

## User flow

1. The admin creates a song and its ordered lyric lines in Supabase Dashboard, then sets its status to published.
2. A visitor opens the public library, which displays published songs only.
3. In practice mode, selecting one lyric line seeks to its start. Selecting adjacent lines makes a practice range.
4. The visitor starts playback once or enables A–B looping for the selected range. Playback stops or seeks back at the selected end timestamp.
5. The active lyric line is highlighted. The visitor may slow playback to support pronunciation practice.

## Screens

### Library

Shows published songs and supports opening one for practice and a quick title search. It has no create or edit actions.

### Practice

Shows the YouTube player, playback speed and loop controls, the currently selected range, and a clickable list of timestamped lyric lines. Selecting one or more adjacent lines seeks to their start and establishes the loop boundaries.

### Admin data entry

Song data is administered directly in Supabase Dashboard. The database schema enforces required metadata and valid time ordering. The public web intentionally has no song editor or import/export interface.

## Data model and storage

Song data is persisted in Supabase Postgres. A song contains its ID, title, YouTube video ID/URL, publication status, and ordered lyric lines. Each line contains its ID, Korean lyrics, optional romanization, optional Vietnamese meaning, display order, and start/end times in seconds.

Supabase Row Level Security permits public `SELECT` access to published songs and their lines only. Insert, update, and delete operations remain available only to the admin through Supabase Dashboard credentials; no write-capable credentials are present in the public web app.

## Player behavior

The YouTube player is controlled through its supported embed API. On a selection change, the app seeks to the range start. While looping is enabled, it observes player time and seeks back to the range start once playback reaches the range end. A single selected line is simply a range whose boundaries are that line’s timestamps.

## Validation and error handling

- Show a clear empty state when there are no published songs.
- Show a clear message when published song data cannot be loaded.
- Render an embed error when a YouTube video cannot be played.
- Only allow a practice range consisting of adjacent lines with valid timestamps.
- Hide drafts and malformed/incomplete line data from visitors.

## Verification

Automated tests will cover Supabase data mapping, publication filtering, time/range selection, and loop boundary decisions. Browser-level tests will verify that a visitor sees only published songs, a line selection seeks to the expected time, a contiguous multi-line selection yields correct boundaries, and looping repeats the selected range without crossing its end.
