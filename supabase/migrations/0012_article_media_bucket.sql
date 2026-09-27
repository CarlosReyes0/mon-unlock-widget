-- Public media for /write (photos, audio, short video).
-- The server uploads with the service role. Readers load the public object URL.
-- No anon/authenticated INSERT policy: a public bucket only means the file URL
-- can be fetched. Uploads stay on POST /api/media, which checks type and size.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'article-media',
  'article-media',
  true,
  47185920,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/ogg'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
