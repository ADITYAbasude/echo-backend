import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";
import { VideosSchema } from "./models/broadcastModel.js";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.join(__dirname, "./proto/video.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const videoService = protoDescriptor.proto.VideoTranscoderService;

// Create secure credentials for production
const getCredentials = () => {
  if (process.env.NODE_ENV === 'production') {
    try {
      // For production, use proper TLS
      return grpc.credentials.createSsl();
    } catch (error) {
      console.error('Failed to create SSL credentials:', error);
      throw error;
    }
  }
  // For development, use insecure credentials
  console.warn('Using insecure credentials - not recommended for production');
  return grpc.credentials.createInsecure();
};

// Use environment variable for the service URL
const serviceUrl = process.env.TRANSCODER_URL || "localhost:50051";

const client = new videoService(
  serviceUrl,
  getCredentials(),
  {
    "grpc.max_receive_message_length": 1024 * 1024 * 100, // 100MB
    "grpc.max_send_message_length": 1024 * 1024 * 100, // 100MB
  }
);

const transcodeVideo = (videoKey, pubsub, userId, videoId) => {
  // Notify that transcoding has started
  pubsub.publish("VIDEO_STATUS_UPDATE", {
    videoUploadingAndTranscodingStatus: {
      status: "TRANSCODING",
      userId: userId,
      videoId: videoId,
    },
  });

  return new Promise((resolve, reject) => {
    const call = client.TranscodeVideo((error, response) => {
      if (error) {
        console.error("Transcoding error:", error);
        pubsub.publish("VIDEO_STATUS_UPDATE", {
          videoUploadingAndTranscodingStatus: {
            status: "FAILED",
            userId: userId,
            videoId: videoId,
            error: error.message,
          },
        });
        reject(error);
        return;
      }

      if (!response.success) {
        console.error("Transcoding failed:", response.message);
        pubsub.publish("VIDEO_STATUS_UPDATE", {
          videoUploadingAndTranscodingStatus: {
            status: "FAILED",
            userId: userId,
            videoId: videoId,
            error: response.message,
          },
        });
        reject(new Error(response.message));
        return;
      }

      VideosSchema.findByIdAndUpdate(videoId, {
        $set: {
          "metaData.available_formats": response.transcoded_files,
          "metaData.duration": response.duration,
        },
      })
      .then(() => {
        pubsub.publish("VIDEO_STATUS_UPDATE", {
          videoUploadingAndTranscodingStatus: {
            status: "TRANSCODED",
            userId: userId,
            videoId: videoId,
          },
        });
        resolve(response);
      })
      .catch((err) => {
        console.error("Error updating video metadata:", err);
        pubsub.publish("VIDEO_STATUS_UPDATE", {
          videoUploadingAndTranscodingStatus: {
            status: "FAILED",
            userId: userId,
            videoId: videoId,
            error: "Failed to update video metadata",
          },
        });
        reject(err);
      });
    });

    call.write({ filename: videoKey });
    call.end();

    // Add error handler for stream errors
    call.on('error', (err) => {
      console.error("Stream error:", err);
      pubsub.publish("VIDEO_STATUS_UPDATE", {
        videoUploadingAndTranscodingStatus: {
          status: "FAILED",
          userId: userId,
          videoId: videoId,
          error: "Stream error: " + err.message,
        },
      });
      reject(err);
    });
  });
};

export default transcodeVideo;
