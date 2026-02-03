#!/usr/bin/env node

/**
 * Sample Media Download Script
 * Downloads free, openly-licensed media for system design projects
 *
 * Usage:
 *   node download-media.mjs              # Download all media
 *   node download-media.mjs --project spotify  # Download for specific project
 *   node download-media.mjs --list       # List available projects
 */

import { mkdir, writeFile, access } from 'fs/promises';
import { createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Pexels provides free videos with CC0 license
// These are actual Pexels video URLs that work
const MEDIA_CONFIG = {
  tiktok: {
    description: 'Short-form vertical videos (15-60 seconds)',
    videos: [
      {
        name: 'dance_1.mp4',
        url: 'https://videos.pexels.com/video-files/3015510/3015510-hd_1080_1920_24fps.mp4',
        description: 'Dancing video'
      },
      {
        name: 'cooking_1.mp4',
        url: 'https://videos.pexels.com/video-files/3298572/3298572-hd_1080_1920_30fps.mp4',
        description: 'Cooking video'
      },
      {
        name: 'fitness_1.mp4',
        url: 'https://videos.pexels.com/video-files/4057419/4057419-hd_1080_1920_25fps.mp4',
        description: 'Fitness workout'
      }
    ],
    targetDir: 'videos/tiktok'
  },
  youtube: {
    description: 'Horizontal videos and thumbnails',
    videos: [
      {
        name: 'tutorial_1.mp4',
        url: 'https://videos.pexels.com/video-files/7710243/7710243-hd_1920_1080_30fps.mp4',
        description: 'Tutorial style video'
      },
      {
        name: 'nature_1.mp4',
        url: 'https://videos.pexels.com/video-files/3571264/3571264-hd_1920_1080_30fps.mp4',
        description: 'Nature documentary style'
      }
    ],
    targetDir: 'videos/youtube'
  },
  netflix: {
    description: 'TV show / movie style content',
    videos: [
      {
        name: 'cinematic_1.mp4',
        url: 'https://videos.pexels.com/video-files/5752729/5752729-hd_1920_1080_24fps.mp4',
        description: 'Cinematic footage'
      }
    ],
    images: [
      { name: 'poster_1.jpg', url: 'https://images.pexels.com/photos/7991579/pexels-photo-7991579.jpeg?w=400', description: 'Show poster' },
      { name: 'backdrop_1.jpg', url: 'https://images.pexels.com/photos/1117132/pexels-photo-1117132.jpeg?w=1200', description: 'Backdrop image' }
    ],
    targetDir: 'videos/netflix'
  },
  spotify: {
    description: 'Album art and audio samples',
    images: [
      { name: 'album_1.jpg', url: 'https://images.pexels.com/photos/1626481/pexels-photo-1626481.jpeg?w=400', description: 'Album cover 1' },
      { name: 'album_2.jpg', url: 'https://images.pexels.com/photos/1389429/pexels-photo-1389429.jpeg?w=400', description: 'Album cover 2' },
      { name: 'album_3.jpg', url: 'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?w=400', description: 'Album cover 3' },
      { name: 'album_4.jpg', url: 'https://images.pexels.com/photos/167092/pexels-photo-167092.jpeg?w=400', description: 'Album cover 4' }
    ],
    targetDir: 'audio/spotify'
  },
  gallery: {
    description: 'Sample gallery images',
    images: [
      { name: 'photo_1.jpg', url: 'https://images.pexels.com/photos/1054218/pexels-photo-1054218.jpeg?w=800', description: 'Landscape' },
      { name: 'photo_2.jpg', url: 'https://images.pexels.com/photos/1591373/pexels-photo-1591373.jpeg?w=800', description: 'Architecture' },
      { name: 'photo_3.jpg', url: 'https://images.pexels.com/photos/2662116/pexels-photo-2662116.jpeg?w=800', description: 'Nature' },
      { name: 'photo_4.jpg', url: 'https://images.pexels.com/photos/3408744/pexels-photo-3408744.jpeg?w=800', description: 'Portrait' },
      { name: 'photo_5.jpg', url: 'https://images.pexels.com/photos/2253275/pexels-photo-2253275.jpeg?w=800', description: 'City' }
    ],
    targetDir: 'images/gallery'
  },
  icloud: {
    description: 'Sample photos for iCloud sync',
    images: [
      { name: 'IMG_001.jpg', url: 'https://images.pexels.com/photos/1133957/pexels-photo-1133957.jpeg?w=800', description: 'Photo 1' },
      { name: 'IMG_002.jpg', url: 'https://images.pexels.com/photos/1266810/pexels-photo-1266810.jpeg?w=800', description: 'Photo 2' },
      { name: 'IMG_003.jpg', url: 'https://images.pexels.com/photos/1366919/pexels-photo-1366919.jpeg?w=800', description: 'Photo 3' }
    ],
    targetDir: 'images/icloud'
  }
};

async function downloadFile(url, destPath) {
  await mkdir(dirname(destPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destPath);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      file.on('error', (err) => {
        file.close();
        reject(err);
      });
    });

    request.on('error', reject);
    request.setTimeout(60000, () => {
      request.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadForProject(projectName, config) {
  console.log(`\n📦 Downloading media for: ${projectName}`);
  console.log(`   ${config.description}`);

  const items = [...(config.videos || []), ...(config.images || [])];

  for (const item of items) {
    const destPath = join(__dirname, config.targetDir, item.name);

    if (await fileExists(destPath)) {
      console.log(`   ✓ ${item.name} (already exists)`);
      continue;
    }

    console.log(`   ⬇ Downloading ${item.name}...`);
    try {
      await downloadFile(item.url, destPath);
      console.log(`   ✓ ${item.name}`);
    } catch (error) {
      console.log(`   ✗ ${item.name}: ${error.message}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    console.log('\nAvailable projects:');
    for (const [name, config] of Object.entries(MEDIA_CONFIG)) {
      console.log(`  ${name.padEnd(12)} - ${config.description}`);
    }
    process.exit(0);
  }

  const projectIndex = args.indexOf('--project');
  const selectedProject = projectIndex !== -1 ? args[projectIndex + 1] : null;

  console.log('🎬 Sample Media Downloader');
  console.log('==========================');
  console.log('Downloading free, openly-licensed media from Pexels.');
  console.log('All media is CC0 licensed and free for any use.\n');

  if (selectedProject) {
    if (!MEDIA_CONFIG[selectedProject]) {
      console.error(`Unknown project: ${selectedProject}`);
      console.error('Use --list to see available projects');
      process.exit(1);
    }
    await downloadForProject(selectedProject, MEDIA_CONFIG[selectedProject]);
  } else {
    for (const [name, config] of Object.entries(MEDIA_CONFIG)) {
      await downloadForProject(name, config);
    }
  }

  console.log('\n✅ Download complete!');
  console.log('\nNext steps:');
  console.log('1. Copy media to project public directories');
  console.log('2. Update seed files if needed');
  console.log('3. Run npm run db:seed to populate database');
}

main().catch(console.error);
