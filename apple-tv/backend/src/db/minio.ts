import * as Minio from 'minio';
import config from '../config/index.js';

/** MinIO object storage client for video and thumbnail asset management. */
const minioClient = new Minio.Client({
  endPoint: config.minio.endPoint,
  port: config.minio.port,
  useSSL: config.minio.useSSL,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey
});

// Ensure buckets exist
/** Creates required MinIO buckets (videos, thumbnails) if they do not already exist. */
const initBuckets = async (): Promise<void> => {
  const buckets: string[] = [config.buckets.videos, config.buckets.thumbnails];

  for (const bucket of buckets) {
    const exists = await minioClient.bucketExists(bucket);
    if (!exists) {
      await minioClient.makeBucket(bucket);
      console.log(`Created bucket: ${bucket}`);
    }
  }
};

export { minioClient as client, initBuckets };
