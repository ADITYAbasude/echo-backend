import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client } from "../config/awsS3Config.js";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv";
dotenv.config();

const SIGNED_URL_EXPIRATION = 21540; // 5 hours 59 minutes in seconds

export const putObject = async (key, contentType) => {
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_VIDEO_STORAGE_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  const signedUrl = await getSignedUrl(s3Client, command);
  return signedUrl;
};

export const getObject = async (key) => {
  const command = new GetObjectCommand({
    Bucket: process.env.AWS_TRANSCODED_VIDEO_STORAGE_BUCKET_NAME,
    Key: key,
  });

  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: SIGNED_URL_EXPIRATION,
  });
  return signedUrl;
};

export const listObjects = async (key) => {
  const command = new ListObjectsV2Command({
    Bucket: process.env.AWS_TRANSCODED_VIDEO_STORAGE_BUCKET_NAME,
    key: key,
  });
  const list = await s3Client.send(command);
  return list;
};

export const getHLSSignedUrls = async (baseKey, resolution) => {
  try {
    const resolutionUrls = {};

    // Get URLs for all available resolutions

    try {
      const masterKey = `transcoded/${baseKey}/${resolution}/index.m3u8`;
      const masterPlaylist = await getObject(masterKey);

      const command = new ListObjectsV2Command({
        Bucket: process.env.AWS_TRANSCODED_VIDEO_STORAGE_BUCKET_NAME,
        Prefix: `transcoded/${baseKey}/${resolution}/`,
      });

      const { Contents } = await s3Client.send(command);

      if (Contents) {
        const segmentUrls = await Promise.all(
          Contents.filter((item) => item.Key.endsWith(".ts")).map(
            async (item) => ({
              name: item.Key.split("/").pop(),
              url: await getObject(item.Key),
            })
          )
        );

        resolutionUrls[resolution] = {
          masterUrl: masterPlaylist,
          segments: segmentUrls,
        };
      }
    } catch (error) {
      console.log(`Resolution ${resolution} not available for ${baseKey}`);
    }

    return {
      resolutions: resolutionUrls,
      success: Object.keys(resolutionUrls).length > 0,
    };
  } catch (error) {
    console.error("Error generating HLS URLs:", error);
    throw error;
  }
};

// delete file from s3
export const deleteObject = async (videoKey) => {
  try {
    const baseKey = `transcoded/${videoKey}/`;

    const listCommand = new ListObjectsV2Command({
      Bucket: process.env.AWS_TRANSCODED_VIDEO_STORAGE_BUCKET_NAME,
      Prefix: baseKey,
    });

    const { Contents } = await s3Client.send(listCommand);

    if (Contents && Contents.length > 0) {
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: process.env.AWS_TRANSCODED_VIDEO_STORAGE_BUCKET_NAME,
        Delete: {
          Objects: Contents.map(({ Key }) => ({ Key })),
          Quiet: false,
        },
      });
      await s3Client.send(deleteCommand);
    }

    // Delete from original bucket
    const deleteOriginal = new DeleteObjectsCommand({
      Bucket: process.env.AWS_VIDEO_STORAGE_BUCKET_NAME,
      Delete: {
        Objects: [{ Key: `video-storage/${videoKey}` }],
        Quiet: false,
      },
    });
    await s3Client.send(deleteOriginal);
  } catch (error) {
    console.error("Error deleting objects:", error);
    throw error;
  }
};
