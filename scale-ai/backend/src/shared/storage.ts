import { Client } from 'minio'

// MinIO configuration from environment or defaults
const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
})

// Bucket names
export const DRAWINGS_BUCKET = 'drawings'
export const MODELS_BUCKET = 'models'

// Ensure buckets exist
export async function ensureBuckets(): Promise<void> {
  for (const bucket of [DRAWINGS_BUCKET, MODELS_BUCKET]) {
    const exists = await minioClient.bucketExists(bucket)
    if (!exists) {
      await minioClient.makeBucket(bucket)
      console.log(`Created bucket: ${bucket}`)
    }
  }
}

// Upload JSON data
export async function uploadDrawing(
  drawingId: string,
  data: object
): Promise<string> {
  const objectName = `${drawingId}.json`
  const buffer = Buffer.from(JSON.stringify(data))

  await minioClient.putObject(DRAWINGS_BUCKET, objectName, buffer, buffer.length, {
    'Content-Type': 'application/json',
  })

  return objectName
}

// Download drawing data
export async function getDrawing(objectName: string): Promise<object> {
  const stream = await minioClient.getObject(DRAWINGS_BUCKET, objectName)
  const chunks: Buffer[] = []

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', () => {
      const data = Buffer.concat(chunks).toString('utf-8')
      resolve(JSON.parse(data))
    })
    stream.on('error', reject)
  })
}

// Upload trained model
export async function uploadModel(
  modelId: string,
  modelBuffer: Buffer
): Promise<string> {
  const objectName = `${modelId}.pt`

  await minioClient.putObject(MODELS_BUCKET, objectName, modelBuffer, modelBuffer.length, {
    'Content-Type': 'application/octet-stream',
  })

  return objectName
}

// Get model
export async function getModel(objectName: string): Promise<Buffer> {
  const stream = await minioClient.getObject(MODELS_BUCKET, objectName)
  const chunks: Buffer[] = []

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

// List drawings in bucket
export async function listDrawings(prefix?: string): Promise<string[]> {
  const objects: string[] = []
  const stream = minioClient.listObjects(DRAWINGS_BUCKET, prefix)

  return new Promise((resolve, reject) => {
    stream.on('data', (obj) => {
      if (obj.name) objects.push(obj.name)
    })
    stream.on('end', () => resolve(objects))
    stream.on('error', reject)
  })
}

export { minioClient }
