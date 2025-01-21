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
    "grpc.keepalive_time_ms": 10000,
    "grpc.keepalive_timeout_ms": 5000,
    "grpc.keepalive_permit_without_calls": 1,
    "grpc.enable_http_proxy": 0,
    "grpc.max_receive_message_length": 1024 * 1024 * 100, // 100MB
    "grpc.max_send_message_length": 1024 * 1024 * 100, // 100MB
  }
);

const transcodeVideo = (videoKey, pubsub, userId, videoId) => {
  const call = client.TranscodeVideo(async (error, response) => {
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
      return;
    }

    await VideosSchema.findByIdAndUpdate(videoId, {
      $set: {
        "metaData.available_formats": response.transcoded_files,
        "metaData.duration": response.duration,
      },
    });

    pubsub.publish("VIDEO_STATUS_UPDATE", {
      videoUploadingAndTranscodingStatus: {
        status: "TRANSCODED",
        userId: userId,
        videoId: videoId,
      },
    });
  });

  call.write({
    filename: videoKey,
  });
  call.end();
};

export default transcodeVideo;
