const fs = require("fs");
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET } = require("../config");

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

async function uploadToS3(localFile, s3Key) {
  const body = fs.readFileSync(localFile);
  const contentType = s3Key.endsWith(".vtt") ? "text/vtt" : "audio/wav";
  await s3.send(
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: s3Key, Body: body, ContentType: contentType })
  );
}

async function existsOnS3(s3Key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
    return true;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound" || err?.Code === "NotFound") {
      return false;
    }
    throw err;
  }
}

module.exports = { s3, uploadToS3, existsOnS3 };
