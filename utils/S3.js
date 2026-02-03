// ============================================================================
// AWS S3 UTILITIES
// Using AWS SDK v3 for file upload/delete operations
// ============================================================================

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

// ============================================================================
// S3 CLIENT INITIALIZATION
// ============================================================================

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// ============================================================================
// UPLOAD FILE
// ============================================================================

/**
 * Upload file to S3 bucket
 * @param {object} file - Multer file object with buffer and mimetype
 * @param {string} bucketName - S3 bucket name
 * @param {string} filename - Key/path for the file in S3
 * @returns {Promise<string>} - URL of uploaded file
 */
const uploadFile = async (file, bucketName, filename) => {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: filename,
    Body: file.buffer,
    ContentType: file.mimetype,
  });

  await s3Client.send(command);

  // Return the file URL
  const region = process.env.AWS_REGION || "ap-south-1";
  return `https://${bucketName}.s3.${region}.amazonaws.com/${filename}`;
};

// ============================================================================
// DELETE FILE
// ============================================================================

/**
 * Delete file from S3 bucket
 * @param {string} fileKey - Key/path of the file in S3
 * @returns {Promise<void>}
 */
const deleteFile = async (fileKey) => {
  const command = new DeleteObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileKey,
  });

  return s3Client.send(command);
};

module.exports = { uploadFile, deleteFile, s3Client };
