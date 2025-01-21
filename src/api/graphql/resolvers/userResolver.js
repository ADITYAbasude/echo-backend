import userService from "../../services/userService.js";
import { authenticateUser } from "../../../utils/authenticatUser.js";
import SettingsSchema from "../../../models/settingsModel.js";
import redisClient from "../../../config/redisConfig.js";
import {
  BroadcasterSchema,
  VideosSchema,
} from "../../../models/broadcastModel.js";
const UserResolver = {
  Mutation: {
    createUser: async (_, { input }, context) => {
      try {
        authenticateUser(context);
        return await userService.createUser(input);
      } catch (error) {
        return { message: error.message, success: false };
      }
    },
    updateUserSettings: async (_, { input }, context) => {
      try {
        authenticateUser(context);

        const auth0ID = context.req.user.sub.split("|")[1];
        const authDetails = await userService.getUserById(auth0ID);

        if (!authDetails) {
          throw new Error("User not found");
        }

        // Validate settings
        const { defaultVolume, defaultPlaybackSpeed } = input;
        if (defaultVolume < 0 || defaultVolume > 100) {
          throw new Error("Invalid volume value");
        }
        if (defaultPlaybackSpeed < 0.5 || defaultPlaybackSpeed > 2) {
          throw new Error("Invalid playback speed");
        }

        // Update or create settings
        await SettingsSchema.findOneAndUpdate(
          { primaryAuthId: authDetails.primaryAuthId },
          { $set: { ...input } },
          { upsert: true, new: true }
        );

        return {
          success: true,
          message: "Settings updated successfully",
        };
      } catch (error) {
        console.error("Error in updateUserSettings:", error);
        return {
          success: false,
          message: error.message || "Failed to update settings",
        };
      }
    },
  },

  Query: {
    getUser: async (_, { id }) => {
      //TODO: add caching to this query to reduce the number of requests to the database
      return userService.getUserById(id);
    },
    getSingleBroadcaster: async (_, { broadcastName }) => {
      try {
        //TODO: add caching to this query to reduce the number of requests to the database
        return userService.getSingleBroadcaster(broadcastName);
      } catch (error) {
        console.log("Error:", error);
      }
    },
    getHomeContent: async () => {
      try {
        const result = await userService.getHomeContent();
        if (!result) {
          throw new Error("Failed to fetch home content");
        }
        return result;
      } catch (error) {
        console.error("Error in getHomeContent:", error);
        throw error;
      }
    },
    getSettings: async (_, __, context) => {
      try {
        authenticateUser(context);

        const auth0ID = context.req.user.sub.split("|")[1];
        const authDetails = await userService.getUserById(auth0ID);

        if (!authDetails) {
          throw new Error("User not found");
        }

        const settings = await SettingsSchema.findOne({
          primaryAuthId: authDetails.primaryAuthId,
        });

        // Return default settings if none found
        if (!settings) {
          const defaultSettings = {
            defaultQuality: "auto",
            enableHotkeys: true,
            defaultVolume: 100,
            defaultPlaybackSpeed: 1,
            autoPlay: true,
          };

          // Create default settings in database
          await SettingsSchema.create({
            ...defaultSettings,
            primaryAuthId: authDetails.primaryAuthId,
          });

          return defaultSettings;
        }

        return settings;
      } catch (error) {
        console.error("Error in getSettings:", error);
        throw new Error(error.message || "Failed to fetch settings");
      }
    },
    searchQuery: async (_, { query }) => {
      try {
        if (!query || query.length < 2) {
          return { videos: [], broadcasters: [] };
        }
        const cacheKey = `search:${query}`;

        // Try to get cached results first
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
          return JSON.parse(cachedResults);
        }

        // Perform parallel searches
        const [videos, broadcasters] = await Promise.all([
          VideosSchema.find(
            {
              $text: { $search: query },
              draft: false,
            },
            {
              score: { $meta: "textScore" },
              "metaData.title": 1,
              "metaData.posterUrl": 1,
              "metaData.description": 1,
              "metaData.viewCount": 1,
              "metaData.duration": 1,
              createdAt: 1,
            }
          )
            .sort({ score: { $meta: "textScore" } })
            .limit(5),

          BroadcasterSchema.find(
            { $text: { $search: query } },
            {
              score: { $meta: "textScore" },
              broadcastName: 1,
              aboutBroadcast: 1,
              broadcastImg: 1,
            }
          )
            .sort({ score: { $meta: "textScore" } })
            .limit(3),
        ]);

        const results = { videos, broadcasters };

        // Cache results for 5 minutes
        await redisClient.setEx(cacheKey, 300, JSON.stringify(results));

        return results;
      } catch (error) {
        console.error("Search error:", error);
        throw new Error("Failed to perform search");
      }
    },
  },

  BroadcastDetails: {
    videos: async (_, { broadcastId }) => {
      return userService.getBroadcastVideos(broadcastId);
    },
    isJoined: async (_, __, context) => {
      if (!context.req.user) return false;
      if (!context.req.broadcast) return false;
      // if (!context.req.broadcast)
      const authId = context.req.user.sub.split("|")[1];
      if (!authId) return false;

      const broadcast = await BroadcasterSchema.findOne({
        _id: context.req.broadcast.broadcastID,
      });
      return broadcast.broadcastMembers.some(
        (member) => member.primaryAuthId === user.primaryAuthId
      );
    },
  },
};

export default UserResolver;
