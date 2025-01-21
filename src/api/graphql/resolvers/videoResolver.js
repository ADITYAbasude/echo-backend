import { default as GraphQLUpload } from "graphql-upload/GraphQLUpload.mjs";
import { authenticateUser } from "../../../utils/authenticatUser.js";
import { authenticateBroadcastToken } from "../../../utils/authenticateBroadcastToken.js";
import { v4 as uuidv4 } from "uuid";
import transcodeVideo from "../../../client.js";
import cloudinary from "../../../config/cloudinaryConfig.js";
import {
  BroadcasterSchema,
  VideosSchema,
} from "../../../models/broadcastModel.js";
import UserSchema from "../../../models/userModel.js";
import { PubSub, withFilter } from "graphql-subscriptions";
import redisClient from "../../../config/redisConfig.js"; // Ensure redisClient is imported
import {
  deleteObject,
  getHLSSignedUrls,
  putObject,
} from "../../../utils/awsSignedURL.js";
import { GraphQLJSON } from "graphql-type-json";
import SettingsModel from "../../../models/settingsModel.js";
import settingsModel from "../../../models/settingsModel.js";
import CollectionSchema from "../../../models/collectionModel.js";

const pubsub = new PubSub();

const videoResolver = {
  Upload: GraphQLUpload,
  JSON: GraphQLJSON,
  Query: {
    getBroadcastVideos: async (_, { broadcastName }) => {
      const broadcastNameToIDKey = `broadcastNameToID:${broadcastName}`;

      const broadcastID = await JSON.parse(
        redisClient.get(broadcastNameToIDKey)
      );

      if (!broadcastID) {
        const videos = await VideosSchema.find({
          broadcastID: broadcastID,
          draft: false,
        });
        if (!videos) return [];
        return videos;
      }
      const broadcast = await BroadcasterSchema.findOne({ broadcastName });
      if (!broadcast) return [];
      await redisClient.set(broadcastNameToIDKey, broadcast._id, "EX", 60 * 60);
      const videos = await VideosSchema.find({ broadcastID: broadcast._id });
      if (!videos) return [];
      return videos;
    },
    getBroadcastVideosByToken: async (_, __, context) => {
      // TODO: optimize this function to use redis
      authenticateUser(context);
      if (!context.req.broadcast) return [];
      const broadcastID = context.req.broadcast.broadcastID;
      const videos = await VideosSchema.find({ broadcastID });
      if (!videos) return [];
      return videos;
    },
    getVideoByID: async (_, { videoID }) => {
      if (!videoID) return null;

      const cacheKey = `video:${videoID}`;
      const cacheVideo = await redisClient.get(cacheKey);

      if (cacheVideo) {
        return JSON.parse(cacheVideo);
      }
      const video = await VideosSchema.findById(videoID);
      if (!video) return null;
      const cachedVideo = await redisClient.set(
        cacheKey,
        JSON.stringify(video),
        "EX",
        60
      );
      return cachedVideo;
    },
    getVideoSignedUrl: async (_, { videoID }, context) => {
      if (!videoID) {
        return { masterUrl: null, segments: null, success: false };
      }

      const video = await VideosSchema.findById(videoID);
      if (!video) {
        return { masterUrl: null, segments: null, success: false };
      }

      let defaultVideoQuality = "medium";

      if (context?.req?.user) {
        const userDetails = await UserSchema.findOne({
          authProviders: {
            $elemMatch: { oAuthID: context.req.user.sub.split("|")[1] },
          },
        });

        if (userDetails) {
          const userSettings = await settingsModel.findOne({
            primaryAuthId: userDetails.primaryAuthId,
          });
          if (userSettings) {
            defaultVideoQuality = userSettings.defaultQuality;
          }

          // Update watch history
          try {
            const watchHistoryEntry = {
              videoId: videoID,
              watchedAt: new Date(),
              watchDuration: 0,
            };

            // Try to update existing collection first - remove old entry and add new one
            await CollectionSchema.findOneAndUpdate(
              { primaryAuthId: userDetails.primaryAuthId },
              {
                $pull: { watchHistory: { videoId: videoID } }, // Remove old entry
              }
            );

            // Add new entry at the beginning
            await CollectionSchema.findOneAndUpdate(
              { primaryAuthId: userDetails.primaryAuthId },
              {
                $push: {
                  watchHistory: {
                    $each: [watchHistoryEntry],
                    $position: 0, // Add at the beginning of the array
                  },
                },
              },
              { new: true, upsert: true } // Create if doesn't exist
            );

            // Clear collection cache
            await redisClient.del(`collection:${userDetails.primaryAuthId}`);
          } catch (error) {
            console.error("Error updating watch history:", error);
          }
        }
      }

      let resolution;
      switch (defaultVideoQuality) {
        case "high":
          resolution =
            video.metaData.available_formats[
              video.metaData.available_formats.length - 1
            ];
          break;
        case "medium":
          resolution =
            video.metaData.available_formats[
              Math.floor(video.metaData.available_formats.length / 2)
            ];
          break;
        case "low":
          resolution = video.metaData.available_formats[0];
          break;
        default:
          resolution =
            video.metaData.available_formats[
              Math.floor(video.metaData.available_formats.length / 2)
            ];
      }

      try {
        const result = await getHLSSignedUrls(video.videoKey, resolution);
        return { ...result, initialResolution: resolution };
      } catch (error) {
        console.error("Error generating signed URLs:", error);
        return { masterUrl: null, segments: null, success: false };
      }
    },
  },
  Video: {
    metaData: async (parent) => {
      return parent.metaData;
    },
    collaboration: async (parent) => {
      if (!parent.collaboration) return null;
      // Populate the broadcast details
      const broadcast = await BroadcasterSchema.findById(
        parent.collaboration.broadcastID
      );
      return {
        ...parent.collaboration,
        broadcast: broadcast,
      };
    },
    broadcast: async (parent) => {
      const broadcast = await BroadcasterSchema.findById(parent.broadcastID);
      return broadcast;
    },
    videoAddBy: async (parent) => {
      const user = await UserSchema.findOne({
        primaryAuthId: parent.primaryAuthId,
      });
      return user;
    },
    userSettings: async (parent) => {
      const settings = await SettingsModel.findOne({
        primaryAuthId: parent.primaryAuthId,
      });
      return settings;
    },
  },
  Mutation: {
    getVideoUploadUrl: async (_, __, context) => {
      authenticateUser(context);
      if (!authenticateBroadcastToken(context))
        return { signedUrl: null, videoID: null, success: false };

      const userId = context.req.user.sub.split("|")[1];
      // get primaryAuthID
      const userDetails = await UserSchema.findOne({
        authProviders: { $elemMatch: { oAuthID: userId } },
      });
      const filename = `${uuidv4()}`;

      try {
        const videoDoc = await VideosSchema({
          videoKey: `${filename}`,
          broadcastID: context.req.broadcast.broadcastID,
          primaryAuthId: userDetails.primaryAuthId,
        }).save();
        const signedURL = await putObject(
          `video-storage/${filename}`,
          "video/mp4"
        );
        return {
          signedUrl: signedURL,
          videoID: videoDoc._id,
          success: true,
        };
      } catch (error) {
        console.error("Error generating signed URL:", error);
        return { signedUrl: null, videoID: null, success: false };
      }
    },

    // Update existing uploadVideo mutation to handle post-upload processing
    uploadVideo: async (_, { videoId }, context) => {
      authenticateUser(context);
      if (!authenticateBroadcastToken(context))
        return { message: "Unauthorized", success: false };

      const userId = context.req.user.sub.split("|")[1];
      // get primaryAuthID
      const userDetails = await UserSchema.findOne({
        authProviders: { $elemMatch: { oAuthID: userId } },
      });
      try {
        const video = await VideosSchema.findOne({
          _id: videoId,
          primaryAuthId: userDetails.primaryAuthId,
        });

        if (!video) {
          return { message: "Video not found", success: false };
        }

        // Start transcoding
        transcodeVideo(
          `video-storage/${video.videoKey}`,
          pubsub,
          userId,
          videoId
        );

        return {
          message: "Video processing started",
          success: true,
          id: videoId,
        };
      } catch (err) {
        pubsub.publish("VIDEO_STATUS_UPDATE", {
          videoUploadingAndTranscodingStatus: {
            status: "FAILED",
            userId: userId,
            videoId: videoId,
          },
        });
        return { message: "Processing failed", success: false };
      }
    },
    storeVideoDetails: async (_, { input }, context) => {
      authenticateUser(context);
      if (!context.req.broadcast)
        return { message: "Unauthorized", success: false };
      const broadcastID = context.req.broadcast.broadcastID;
      const {
        videoTitle,
        videoDescription,
        videoPoster,
        videoDuration,
        videoID,
      } = input;
      const { createReadStream } = await videoPoster;

      const stream = createReadStream();

      if (!videoPoster)
        return {
          message: "Please provide a video poster",
          success: false,
        };

      if ((!broadcastID, !videoTitle, !videoDescription))
        return {
          message: "Please provide all required fields",
          success: false,
        };

      let result;
      try {
        // store the poster img into cloudinary
        result = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: "Echo/video poster",
            },
            (err, result) => {
              if (err) reject(err);
              resolve(result);
            }
          );
          stream.pipe(uploadStream);
        });
      } catch (err) {
        return {
          message: `Error uploading image, ${err.message}`,
          success: false,
        };
      }

      await VideosSchema.findOneAndUpdate(
        { _id: videoID },
        {
          $set: {
            "metaData.title": videoTitle,
            "metaData.description": videoDescription,
            "metaData.posterUrl": result.secure_url,
            draft: false,
          },
        },
        { new: true }
      );

      return {
        message: "Video details stored successfully",
        success: true,
      };
    },
    deleteVideo: async (_, { input }, context) => {
      authenticateUser(context);
      if (!context.req.broadcast)
        return { message: "Unauthorized", success: false };

      const { broadcastID } = context.req.broadcast;
      const { videoID, auth0ID } = input;

      const user = await UserSchema.findOne({
        "authProviders.oAuthID": auth0ID,
      });

      if (!user) {
        return {
          message: "User not found",
          success: false,
        };
      }

      const broadcast = await BroadcasterSchema.findById(broadcastID);

      if (!broadcast) {
        return {
          message: "Broadcast not found",
          success: false,
        };
      }

      const member = broadcast.broadcastMembers.find(
        (member) => member.primaryAuthId === user.primaryAuthId
      );

      if (member.role !== "BROADCASTER" && member.role !== "CO_BROADCASTER") {
        // Changed from promote
        return {
          message: "You are not authorized to delete this video",
          success: false,
        };
      }
      const video = await VideosSchema.findOne({
        _id: videoID,
        broadcastID: broadcastID,
      });

      await deleteObject(video.videoKey);
      await VideosSchema.findOneAndDelete({ _id: videoID });

      return {
        message: "Video deleted successfully",
        success: true,
      };
    },
  },
  Subscription: {
    videoUploadingAndTranscodingStatus: {
      subscribe: withFilter(
        (_, __, context) => {
          return pubsub.asyncIterator(["VIDEO_STATUS_UPDATE"]);
        },
        (payload, variables, context) => {
          return (
            payload.videoUploadingAndTranscodingStatus.userId ===
            variables.userId
          );
        }
      ),
    },
  },
};

export default videoResolver;
