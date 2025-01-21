import { VideosSchema } from "../../../models/broadcastModel.js";
import CollectionSchema from "../../../models/collectionModel.js";
import { authenticateUser } from "../../../utils/authenticatUser.js";
import redisClient from "../../../config/redisConfig.js";
import UserSchema from "../../../models/userModel.js";

const CollectionResolver = {
  Query: {
    getCollection: async (_, __, context) => {
      try {
        authenticateUser(context);
        //get user details
        const userDetails = await UserSchema.findOne({
          authProviders: {
            $elemMatch: { oAuthID: context.req.user.sub.split("|")[1] },
          },
        });
        if (!userDetails) return null;
        const primaryAuthId = userDetails.primaryAuthId;

        // Try to get from cache
        const cacheKey = `collection:${primaryAuthId}`;
        const cachedCollection = await redisClient.get(cacheKey);
        if (cachedCollection) {
          return JSON.parse(cachedCollection);
        }

        let collection = await CollectionSchema.findOne({ primaryAuthId });
        if (!collection) {
          collection = await CollectionSchema.create({ primaryAuthId });
        }

        const stats = {
          watchTime: Math.round(
            collection.watchHistory.reduce(
              (acc, curr) => acc + (curr.watchDuration || 0),
              0
            ) / 3600
          ),
          watchLaterCount: collection.watchLater.length,
        };
        const result = {
          ...collection.toObject(),
          stats,
        };
        // Cache for 5 minutes
        await redisClient.setEx(cacheKey, 300, JSON.stringify(result));

        return result;
      } catch (error) {
        throw new Error(error.message);
      }
    },
  },

  Mutation: {
    addToWatchLater: async (_, { videoId }, context) => {
      try {
        authenticateUser(context);
        const auth0ID = context.req.user.sub.split("|")[1];

        const userDetails = await UserSchema.findOne({
          authProviders: { $elemMatch: { oAuthID: auth0ID } },
        });

        await CollectionSchema.findOneAndUpdate(
          { primaryAuthId: userDetails.primaryAuthId },
          {
            $addToSet: {
              watchLater: { videoId },
            },
          },
          { upsert: true }
        );

        // Clear cache
        await redisClient.del(`collection:${userDetails.primaryAuthId}`);

        return { message: "Added to watch later successfully", success: true };
      } catch (error) {
        return { message: error.message, success: false };
      }
    },

    removeFromWatchLater: async (_, { videoId }, context) => {
      try {
        authenticateUser(context);
        const primaryAuthId = context.req.user.primaryAuthId;

        await CollectionSchema.findOneAndUpdate(
          { primaryAuthId },
          {
            $pull: {
              watchLater: { videoId },
            },
          }
        );

        // Clear cache
        await redisClient.del(`collection:${primaryAuthId}`);

        return {
          message: "Removed from watch later successfully",
          success: true,
        };
      } catch (error) {
        return { message: error.message, success: false };
      }
    },
  },
  WatchHistoryEntry: {
    video: async (parent) => {
      return await VideosSchema.findById(parent.videoId);
    },
  },
  WatchLater: {
    video: async (parent) => {
      return await VideosSchema.findById(parent.videoId);
    },
  },
};

export default CollectionResolver;
