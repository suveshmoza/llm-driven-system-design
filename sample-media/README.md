# Sample Media for System Design Projects

This directory contains sample media files used by various projects in the repository. The media files are not committed to git (to keep the repo size small) but can be downloaded using the provided script.

## Media Status by Project

### Projects Using External URLs (Ready to Use)

These projects already use Unsplash/Pexels URLs that work without local files:

| Project | Status | Notes |
|---------|--------|-------|
| **TikTok** | ✅ Ready | Uses Pexels video URLs + Unsplash thumbnails |
| **Instagram** | ✅ Ready | Uses Unsplash image URLs |
| **Netflix** | ✅ Ready | Uses Unsplash for posters/backdrops/thumbnails |
| **Twitch** | ✅ Ready | Uses Unsplash + BTTV/Twitch CDN for emotes |
| **Apple TV** | ✅ Ready | Uses Unsplash for posters/backdrops |
| **Airbnb** | ✅ Ready | Uses Unsplash property photos |
| **FB Live Comments** | ✅ Ready | Uses Unsplash for avatars |
| **YouTube** | ⚠️ Partial | Thumbnails work (Unsplash), videos require upload pipeline |

### Projects Requiring Downloaded Media

| Project | Media Type | Run Script |
|---------|------------|------------|
| **Spotify** | Audio samples | `node download-media.mjs --project spotify` |
| **Apple Music** | Audio samples | Audio files not yet available |

**Note on Audio**: Free, openly-licensed audio samples are harder to source than images/videos. The download script includes album art but actual playable audio requires either:
1. Using placeholder silent audio files
2. Sourcing from Pixabay Audio, Free Music Archive, or similar
3. Generating test tones with FFmpeg

## Quick Start

```bash
# Download all sample media
node download-media.mjs

# Download media for specific project
node download-media.mjs --project spotify
node download-media.mjs --project netflix
node download-media.mjs --project tiktok
```

## Projects Requiring Media

### Video Projects
| Project | Media Needed | Source |
|---------|-------------|--------|
| TikTok | Short-form videos (15-60s) | Pexels Videos |
| YouTube | Video thumbnails + sample videos | Pexels Videos |
| Netflix | Episode thumbnails + trailers | Pexels Videos |
| Apple TV | Movie/show thumbnails | Unsplash (via seed) |
| Twitch | Stream thumbnails | Unsplash (via seed) |

### Audio Projects
| Project | Media Needed | Source |
|---------|-------------|--------|
| Spotify | Album art + audio samples | Unsplash + Pixabay Audio |
| Apple Music | Album art + audio previews | Unsplash + Pixabay Audio |

### Image Projects
| Project | Media Needed | Source |
|---------|-------------|--------|
| Instagram | Post images | Unsplash (already in seed) |
| Gallery | Sample gallery images | Unsplash |
| iCloud | Sample photos | Unsplash |
| Airbnb | Property photos | Unsplash |
| Etsy | Product images | Unsplash |
| Amazon | Product images | Unsplash |

## Media Sources (All Free/Open License)

- **Unsplash** - Free high-resolution photos (already used in most seeds)
- **Pexels** - Free stock photos and videos (CC0 license)
- **Pixabay** - Free images, videos, and audio (Pixabay License)

## Directory Structure

```
sample-media/
├── README.md           # This file
├── download-media.mjs  # Download script
├── videos/             # Sample video files
│   ├── tiktok/         # Short vertical videos
│   ├── youtube/        # Longer horizontal videos
│   └── netflix/        # Movie/TV episode clips
├── audio/              # Sample audio files
│   ├── spotify/        # Music samples
│   └── apple-music/    # Music previews
└── images/             # Sample images (most projects use Unsplash URLs)
    ├── thumbnails/     # Video thumbnails
    └── covers/         # Album covers
```

## Alternative: Use External URLs

Most projects are already configured to use Unsplash URLs for images, which work without local files. For video/audio projects, you can:

1. **Use placeholder files**: The frontend will show loading states or placeholder content
2. **Update seed files**: Point to public video hosting services like:
   - Pexels Video URLs (free)
   - Coverr.co (free stock video)
   - Archive.org (public domain content)

## Adding Your Own Media

If you want to use your own media:

1. Place files in the appropriate project's `frontend/public/` directory
2. Update the seed file URLs to match your filenames
3. Run `npm run db:seed` to update the database

## Generating Placeholder Media

For testing purposes, you can generate colored placeholder images:

```bash
# Using ImageMagick (install with: brew install imagemagick)
convert -size 800x450 xc:#3B82F6 placeholder-video.jpg
convert -size 300x300 xc:#10B981 placeholder-album.jpg

# Using FFmpeg for video (install with: brew install ffmpeg)
ffmpeg -f lavfi -i color=c=blue:s=1080x1920:d=15 -f lavfi -i anullsrc -t 15 placeholder-tiktok.mp4
```

## Notes

- Video files can be large; the download script only fetches small sample files
- Audio files are typically 30-second previews
- All media is from sources with permissive licenses suitable for educational use
