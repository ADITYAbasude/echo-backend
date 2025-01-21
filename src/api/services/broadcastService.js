import cloudinary from "../../config/cloudinaryConfig.js";
import {
  BroadcasterSchema,
  VideosSchema,
} from "../../models/broadcastModel.js";
import UserSchema from "../../models/userModel.js";
import redisClient from "../../config/redisConfig.js";
import jwt from "jsonwebtoken";

class BroadcastService {

  async verifyBroadcastAccount(broadcastID) {
    try {
      if (!broadcastID) {
        return {
          status: "UNVERIFIED",
          message: "Broadcast not found",
          success: false,
        };
      }

      const broadcast = await BroadcasterSchema.findById(broadcastID);
      if (!broadcast) {
        return {
          status: "UNVERIFIED",
          message: "Broadcast not found",
          success: false,
        };
      }

      return {
        status: "VERIFIED",
        message: "Broadcast account found",
        success: true,
        ...broadcast.toJSON(),
      };
    } catch (error) {
      return {
        status: "UNVERIFIED",
        message: "An error occurred",
        success: false,
      };
    }
  }

  async getBroadcaster(broadcastID) {
    try {
      return await BroadcasterSchema.findById(broadcastID);
    } catch (error) {
      throw new Error(`Error getting broadcaster: ${error.message}`);
    }
  }

  async createBroadcaster(input) {
    const { auth0ID, broadcastName, aboutBroadcast, broadcastImg } = input;

    try {
      // Find user to verify primaryAuthId
      const user = await UserSchema.findOne({
        authProviders: { $elemMatch: { oAuthID: auth0ID } },
      });

      if (!user) {
        return { message: "User not found", success: false };
      }

      const primaryAuthId = user.primaryAuthId;

      // Validate inputs
      if (!broadcastImg) {
        return { message: "Please provide an image", success: false };
      }

      if (!broadcastName || !aboutBroadcast) {
        return {
          message: "Please provide all required fields",
          success: false,
        };
      }

      // Check existing broadcaster
      const findBroadcaster = await BroadcasterSchema.findOne({
        primaryAuthId,
      });
      if (findBroadcaster) {
        return { message: "User already exists", success: false };
      }

      const findBroadcasterByName = await BroadcasterSchema.findOne({
        broadcastName,
      });
      if (findBroadcasterByName) {
        return { message: "Broadcast name already exists", success: false };
      }

      // Upload image
      const { createReadStream } = await broadcastImg;
      const stream = createReadStream();
      let uploadResult;
      try {
        uploadResult = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            { folder: "Echo/Broadcast avatar" },
            (err, res) => {
              if (err) reject(err);
              resolve(res);
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

      // Create broadcaster
      const broadcast = await BroadcasterSchema({
        primaryAuthId,
        broadcastName,
        aboutBroadcast,
        broadcastImg: uploadResult.secure_url,
        broadcastMembers: [{ primaryAuthId, role: "BROADCASTER" }],
      }).save();

      // Generate token
      const token = jwt.sign(
        {
          primaryAuthId,
          broadcastID: broadcast._id,
        },
        process.env.JWT_SECRET
      );

      return { message: token, success: true };
    } catch (error) {
      return { message: error.message, success: false };
    }
  }

  async requestVideoCollaboration(input, requesterBroadcastID) {
    const { collaboratorID, videoID } = input;

    try {
      // Find the video
      const video = await VideosSchema.findById(videoID);
      if (!video) {
        return { message: "Video not found", success: false };
      }

      // Check existing collaboration
      if (video.collaboration && video.collaboration.broadcastID) {
        return {
          message: "Collaboration request already exists for this video",
          success: false,
        };
      }

      // Update video with collaboration
      video.collaboration = {
        broadcastID: collaboratorID,
        status: "ACCEPTED",
      };
      await video.save();

      // Get sender broadcast name
      const senderBroadcast = await BroadcasterSchema.findById(
        requesterBroadcastID
      );

      return {
        message: "Collaboration request sent successfully",
        success: true,
        notificationData: {
          videoID,
          receiverBroadcastID: collaboratorID,
          senderBroadcastName: senderBroadcast.broadcastName,
          status: "ACCEPTED",
        },
      };
    } catch (error) {
      throw new Error(`Error requesting video collaboration: ${error.message}`);
    }
  }

  // Helper method to get broadcast from cache or database
  async _getBroadcastFromCache(cacheKey, broadcastID) {
    const cacheBroadcast = await redisClient.get(cacheKey);

    if (!cacheBroadcast) {
      const broadcast = await BroadcasterSchema.findById(broadcastID);
      if (broadcast) {
        await redisClient.set(
          cacheKey,
          JSON.stringify(broadcast),
          "EX",
          60 * 60
        );
      }
      return broadcast;
    }

    const parsedBroadcast = JSON.parse(cacheBroadcast);
    return await BroadcasterSchema.findById(parsedBroadcast._id);
  }
}

export default new BroadcastService();
