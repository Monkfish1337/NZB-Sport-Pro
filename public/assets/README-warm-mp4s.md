# Warm-to-cache placeholder MP4s

The `/warm/...` route returns a 302 redirect to one of three tiny MP4 files
served from `/assets/`. Stremio's player plays whichever one it gets so the
user sees feedback after clicking a `🔥 Warm to TorBox` row.

Three files needed:
- `warm-added.mp4` — "Added to TorBox — check back in 2-5 minutes"
- `warm-failed.mp4` — "Could not warm — check /admin/logs"
- `warm-rate-limited.mp4` — "Too many warm requests — wait a minute"

## Generate them with ffmpeg

The Dockerfile doesn't ship ffmpeg, so generate these on a host that has it
(your media-stack machine probably does via Jellyfin or similar) and copy
into `public/assets/`.

```bash
cd public/assets

# Success — "Added to TorBox, check back in 2-5 minutes"
ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=8 \
  -vf "drawtext=text='Added to TorBox':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=h/2-80,\
       drawtext=text='Check back in 2-5 minutes':fontcolor=#aaaaaa:fontsize=36:x=(w-text_w)/2:y=h/2+20,\
       drawtext=text='SeriousSportSync':fontcolor=#ef4444:fontsize=28:x=(w-text_w)/2:y=h-80" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart \
  warm-added.mp4

# Failed — "Could not warm"
ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=8 \
  -vf "drawtext=text='Could not warm':fontcolor=#ff6b6b:fontsize=64:x=(w-text_w)/2:y=h/2-80,\
       drawtext=text='Check /admin/logs for details':fontcolor=#aaaaaa:fontsize=36:x=(w-text_w)/2:y=h/2+20,\
       drawtext=text='SeriousSportSync':fontcolor=#ef4444:fontsize=28:x=(w-text_w)/2:y=h-80" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart \
  warm-failed.mp4

# Rate-limited — "Slow down"
ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=8 \
  -vf "drawtext=text='Too many warm requests':fontcolor=#ffd166:fontsize=56:x=(w-text_w)/2:y=h/2-80,\
       drawtext=text='Wait a minute and try again':fontcolor=#aaaaaa:fontsize=36:x=(w-text_w)/2:y=h/2+20,\
       drawtext=text='SeriousSportSync':fontcolor=#ef4444:fontsize=28:x=(w-text_w)/2:y=h-80" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart \
  warm-rate-limited.mp4
```

Each file is ~50-80 KB. Check them in to the repo (or just SCP them up
during deploy).

## Alternative — use any tiny mp4

If you don't care about pretty text, any 5-10 second placeholder works. Even
a single black frame in MP4 container will satisfy Stremio's player. The
filenames above are what the `/warm` route redirects to.

## Why not generate them at startup?

ffmpeg adds ~80MB to the Docker image. For a one-time-on-deploy artifact
that's not worth it. If you really want runtime generation, install ffmpeg
in the Dockerfile and call this script on boot — but the deploy-time
approach is simpler.
