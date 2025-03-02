
const AWS = require("aws-sdk");

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();


const uploadFile = async (file, bucketName, filename) => {
  const params = {
    Bucket: bucketName,
    Key: filename,
    Body: file.buffer,
    ContentType: file.mimetype,
  };
  const result = await s3.upload(params).promise();
  return result.Location;
};

const deleteFile = async (fileKey) => {
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileKey,
  };

  return s3.deleteObject(params).promise();
};

module.exports = { uploadFile, deleteFile };
