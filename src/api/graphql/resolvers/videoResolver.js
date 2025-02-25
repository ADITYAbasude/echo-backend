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
import userService from "../../services/userService.js";
import { RedisFlushModes } from "redis";

const pubsub = new PubSub();

const videoResolver = {
  Upload: GraphQLUpload,
  JSON: GraphQLJSON,
  Query: {
    getBroadcastVideos: async (_, { broadcastName }) => {
      const broadcastNameToIDKey = `broadcastVideo:${broadcastName}`;
      const cachedVideos = await redisClient.get(broadcastNameToIDKey);
      if (cachedVideos) {
        return JSON.parse(cachedVideos);
      }      
      const broadcast = await BroadcasterSchema.findOne({ broadcastName });
      if (!broadcast) return [];
      const videos = await VideosSchema.find({ broadcastID: broadcast._id });
      if (!videos) return [];
      await redisClient.set(broadcastNameToIDKey, JSON.stringify(videos));
      await redisClient.expire(broadcastNameToIDKey, 60 * 60);
      return videos;
    },
    getBroadcastVideosByToken: async (_, __, context) => {
      authenticateUser(context);
      if (!(await authenticateBroadcastToken(context))) return [];
      const broadcastID = context.req.broadcast.broadcastID;

      const broadcastVideosByToken = `broadcastVideosByToken:${broadcastID}`;

      const cachedVideos = await redisClient.get(broadcastVideosByToken);
      if (cachedVideos) {
        return JSON.parse(cachedVideos);
      }

      const videos = await VideosSchema.find({ broadcastID });
      if (!videos) return [];
      await redisClient.set(broadcastVideosByToken, JSON.stringify(videos));
      await redisClient.expire(broadcastVideosByToken, 60); // Expire in 1 minute
      return videos;
    },
    getVideoByID: async (_, { videoID }) => {
      console.log("getVideoByID called with videoID:", videoID);
      if (!videoID) return null;

      const cacheKey = `video:${videoID}`;
      const cacheVideo = await redisClient.get(cacheKey);

      if (cacheVideo) {
        return JSON.parse(cacheVideo);
      }
      const video = await VideosSchema.findById(videoID);
      if (!video) return null;
      await redisClient.set(
        cacheKey,
        JSON.stringify(video)
      );
      await redisClient.expire(cacheKey, 60);
      return video;
    },
    getVideoSignedUrl: async (_, { videoID }, context) => {
      console.log("getVideoSignedUrl called with videoID:", videoID);
      if (!videoID) {
        return { masterUrl: null, segments: null, success: false };
      }

      const video = await VideosSchema.findById(videoID);
      if (!video) {
        return { masterUrl: null, segments: null, success: false };
      }

      // Default video quality for unauthenticated users
      let defaultVideoQuality = "medium";

      // Only try to get user preferences if there's an authenticated user
      if (context?.req?.user) {
        try {
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

            // Update watch history for authenticated users
            try {
              const watchHistoryEntry = {
                videoId: videoID,
                watchedAt: new Date(),
                watchDuration: 0,
              };

              await CollectionSchema.findOneAndUpdate(
                { primaryAuthId: userDetails.primaryAuthId },
                {
                  $pull: { watchHistory: { videoId: videoID } },
                }
              );

              await CollectionSchema.findOneAndUpdate(
                { primaryAuthId: userDetails.primaryAuthId },
                {
                  $push: {
                    watchHistory: {
                      $each: [watchHistoryEntry],
                      $position: 0,
                    },
                  },
                },
                { new: true, upsert: true }
              );

              await redisClient.del(`collection:${userDetails.primaryAuthId}`);
            } catch (error) {
              console.error("Error updating watch history:", error);
            }
          }
        } catch (error) {
          console.error("Error getting user details:", error);
          // Continue with default quality on error
        }
      }

      // Get available formats or use default if none specified
      const availableFormats = video.metaData.available_formats || ["360p"];
      
      let resolution;
      switch (defaultVideoQuality) {
        case "high":
          resolution = availableFormats[availableFormats.length - 1];
          break;
        case "medium":
          resolution = availableFormats[Math.floor(availableFormats.length / 2)];
          break;
        case "low":
          resolution = availableFormats[0];
          break;
        default:
          resolution = availableFormats[Math.floor(availableFormats.length / 2)];
      }

      try {
        const result = await getHLSSignedUrls(video.videoKey, resolution);
        console.log("Signed URLs generated successfully:", result);
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
      const userSettingsKey = `userSettings:${parent.primaryAuthId}`;
      const cachedSettings = await redisClient.get(userSettingsKey);
      if (cachedSettings) {
        return JSON.parse(cachedSettings);
      }
      const settings = await SettingsModel.findOne({
        primaryAuthId: parent.primaryAuthId,
      });

      if (!settings) return null;
      await redisClient.set(userSettingsKey, JSON.stringify(settings));
      await redisClient.expire(userSettingsKey, 60); // Expire in 1 minute 
      return settings;
    },
  },
  Mutation: {
    getVideoUploadUrl: async (_, __, context) => {
      authenticateUser(context);
      if (!authenticateBroadcastToken(context))
        return { signedUrl: null, videoID: null, success: false };

      const userId = context.req.user.sub.split("|")[1];
      const userDetails = await userService.getUserById(userId);
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
      if (!(await authenticateBroadcastToken(context)))
        return { message: "Unauthorized", success: false };

      const userId = context.req.user.sub.split("|")[1];
      const userDetails = await userService.getUserById(userId);
      
      try {
        const video = await VideosSchema.findOne({
          _id: videoId,
          primaryAuthId: userDetails.primaryAuthId,
        });

        if (!video) {
          return { message: "Video not found", success: false };
        }

        // Start transcoding without waiting
        transcodeVideo(
          `video-storage/${video.videoKey}`,
          pubsub,
          userId,
          videoId
        ).catch(error => {
          console.error("Transcoding failed:", error);
          pubsub.publish("VIDEO_STATUS_UPDATE", {
            videoUploadingAndTranscodingStatus: {
              status: "FAILED",
              userId: userId,
              videoId: videoId,
              error: error.message,
            },
          });
        });

        // Return immediately while transcoding continues in background
        return {
          message: "Video processing started",
          success: true,
          id: videoId,
        };

      } catch (err) {
        console.error("Upload handling error:", err);
        return { 
          message: "Processing failed: " + err.message, 
          success: false,
          id: videoId,
        };
      }
    },
    storeVideoDetails: async (_, { input }, context) => {
      authenticateUser(context);
      if (!await authenticateBroadcastToken(context))
        return { message: "Unauthorized", success: false };
      const broadcastID = context.req.broadcast.broadcastID;
      const {
        videoTitle,
        videoDescription,
        videoPoster,
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
      if (!await authenticateBroadcastToken(context))
        return { message: "Unauthorized", success: false };

      const { broadcastID } = context.req.broadcast;
      const { videoID, auth0ID } = input;

      const user = await userService.getUserById(auth0ID);

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
      await redisClient.del(`broadcastVideosByToken:${broadcastID}`)
      return {
        message: "Video deleted successfully",
        success: true,
      };
    },
    streamBroadcast: async (_, { input }, context) => {
      authenticateUser(context);

      if (await authenticateBroadcastToken(context)) {
        // check user is broadcaster or not
        const { broadcastID } = context.req.broadcast;

        const userDetails = await userService.getUserById(
          context.req.user.sub.split("|")[1]
        );

        const checkIsBroadcaster = await BroadcasterSchema.find({
          _id: broadcastID,
          broadcastMembers: {
            $elemMatch: {
              primaryAuthId: userDetails.primaryAuthId,
              role: "BROADCASTER",
            },
          },
        });

        console.log(checkIsBroadcaster);

        if (!checkIsBroadcaster) {
          return { message: "Unauthorized", success: false };
        }

        const anyActiveStream = await VideosSchema.findOne({
          broadcastID,
          isLive: true,
        });

        if (anyActiveStream) {
          return {
            message: "There is an active stream already",
            success: false,
          };
        }

        const { title, description, poster } = input;
        const { createReadStream } = await poster;
        const stream = createReadStream();

        if (!title || !description || !poster) {
          return {
            message: "Please provide all required fields",
            success: false,
          };
        }

        let result;
        try {
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

        const videoKey = uuidv4();
        const streamKey = uuidv4();

        await VideosSchema.create({
          metaData: {
            title,
            description,
            posterUrl: result.secure_url,
          },
          draft: false,
          broadcastID,
          primaryAuthId: userDetails.primaryAuthId,
          isLive: true,
          videoKey,
        });
        return {
          message: "Broadcast started successfully",
          success: true,
          streamKey,
        };
      } else {
        return { message: "Unauthorized", success: false };
      }
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
