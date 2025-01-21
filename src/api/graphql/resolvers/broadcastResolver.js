import { default as GraphQLUpload } from "graphql-upload/GraphQLUpload.mjs";
import { PubSub, withFilter } from "graphql-subscriptions";
import { authenticateUser } from "../../../utils/authenticatUser.js";
import UserSchema from "../../../models/userModel.js";
import broadcastService from "../../services/broadcastService.js";
import { BroadcasterSchema } from "../../../models/broadcastModel.js";
import jwt from "jsonwebtoken";
import redisClient from "../../../config/redisConfig.js";
import { authenticateBroadcastToken } from "../../../utils/authenticateBroadcastToken.js";

const pubsub = new PubSub();

const BroadcastResolver = {
  Upload: GraphQLUpload,
  Query: {
    getBroadcastMembers: async (_, { broadcastName }, context) => {
      try {
        authenticateUser(context);
        await authenticateBroadcastToken(context);
        
        const broadcastMemberKey = `broadcastMembers:${broadcastName}`;
        const members = await redisClient.get(broadcastMemberKey);
        if (members) {
          return JSON.parse(members).map((member) => ({
            primaryAuthId: member.primaryAuthId,
            role: member.role,
          }));
        }

        const broadcast = await BroadcasterSchema.findOne({ broadcastName });
        if (!broadcast) return null;

        await redisClient.set(
          broadcastMemberKey,
          JSON.stringify(broadcast.broadcastMembers),
          "EX",
          60
        );
        redisClient.expire(broadcastMemberKey, 60);

        return broadcast.broadcastMembers;
      } catch (error) {
        return [];
      }
    },

    verifyBroadcastAccount: async (_, {}, context) => {
      try {
        if (!authenticateBroadcastToken(context))
          return {
            status: "UNVERIFIED",
            message: "Broadcast not found",
            success: false,
          };
        return await broadcastService.verifyBroadcastAccount(
          context.req.broadcast.broadcastID
        );
      } catch (error) {
        return {
          status: "UNVERIFIED",
          message: "An error occurred",
          success: false,
        };
      }
    },

    getBroadcasters: async (_, { broadcastName }, context) => {
      try {
        authenticateUser(context);
        await authenticateBroadcastToken(context);
        const checkIsBroadcaster = await BroadcasterSchema.findOne(
          context.req.broadcast.broadcastID
        ).where({
          broadcastMembers: {
            $elemMatch: {
              primaryAuthId: context.req.user.primaryAuthId,
              role: "BROADCASTER",
            },
          },
        });
        if (!checkIsBroadcaster) {
          return [];
        }
        return await BroadcasterSchema.find({
          broadcastName: {
            $regex: new RegExp("^" + broadcastName, "i"),
          },
        });
      } catch (error) {
        return [];
      }
    },

    getBroadcaster: async (_, {}, context) => {
      try {
        authenticateUser(context);
        await authenticateBroadcastToken(context);
        return await broadcastService.getBroadcaster(
          context.req.broadcast.broadcastID
        );
      } catch (error) {
        return null;
      }
    },
  },

  Mutation: {
    createBroadcaster: async (_, { input }, context) => {
      authenticateUser(context);
      return await broadcastService.createBroadcaster(input);
    },

    updateBroadcast: async (_, { input }, context) => {
      authenticateUser(context);
      if (!context.req.broadcast) {
        return {
          message: "Not authorized to update broadcast details",
          success: false,
        };
      }
      const { broadcastID, primaryAuthId } = context.req.broadcast;
      try {
        const { broadcastName, aboutBroadcast, broadcastImg } = input;

        // Find the broadcast
        const broadcast = await BroadcasterSchema.findById(broadcastID);
        if (!broadcast) {
          return { message: "Broadcast not found", success: false };
        }

        // Verify broadcaster permission
        const isBroadcaster = broadcast.broadcastMembers.some(
          (member) =>
            member.primaryAuthId === primaryAuthId &&
            member.role === "BROADCASTER"
        );

        // Check if broadcast name is taken (if it's being changed)
        if (broadcastName && broadcastName !== broadcast.broadcastName) {
          const existingBroadcast = await BroadcasterSchema.findOne({
            broadcastName,
          });
          if (existingBroadcast) {
            return { message: "Broadcast name already exists", success: false };
          }
        }

        // Update image if provided
        if (broadcastImg) {
          const { createReadStream } = await broadcastImg;
          const stream = createReadStream();
          try {
            const uploadResult = await new Promise((resolve, reject) => {
              const uploadStream = cloudinary.uploader.upload_stream(
                { folder: "Echo/Broadcast avatar" },
                (err, res) => {
                  if (err) reject(err);
                  resolve(res);
                }
              );
              stream.pipe(uploadStream);
            });
            broadcast.broadcastImg = uploadResult.secure_url;
          } catch (err) {
            return {
              message: `Error uploading image: ${err.message}`,
              success: false,
            };
          }
        }

        // Only update fields that are provided
        if (broadcastName) broadcast.broadcastName = broadcastName;
        if (aboutBroadcast) broadcast.aboutBroadcast = aboutBroadcast;

        await broadcast.save();

        // Clear cache
        const cacheKey = `broadcast:${broadcastID}`;
        await redisClient.del(cacheKey);

        return { message: "Broadcast updated successfully", success: true };
      } catch (error) {
        throw new Error(`Error updating broadcast: ${error.message}`);
      }
    },

    addMember: async (_, { input }, context) => {
      authenticateUser(context);
      const { broadcastID, primaryAuthId } = input;

      try {
        // Verify user exists
        const user = await UserSchema.findOne({ primaryAuthId });
        if (!user) {
          return { message: "User not found", success: false };
        }

        const cacheKey = `broadcast:${broadcastID}`;
        let findBroadcast = await this._getBroadcastFromCache(
          cacheKey,
          broadcastID
        );

        if (!findBroadcast) {
          return { message: "broadcast not found", success: false };
        }

        // Check member existence
        if (
          findBroadcast.broadcastMembers.some(
            (member) => member.primaryAuthId === primaryAuthId
          )
        ) {
          return { message: "member already exists", success: false };
        }

        // Add member
        findBroadcast.broadcastMembers.push({ primaryAuthId });
        await findBroadcast.save();

        // Update cache
        await redisClient.set(
          cacheKey,
          JSON.stringify(findBroadcast),
          "EX",
          60 * 60
        );
        // TODO: give broadcast access token to user
        return { message: "member added successfully", success: true };
      } catch (error) {
        throw new Error(`Error adding member: ${error.message}`);
      }
    },

    updateRole: async (_, { input }, context) => {
      authenticateUser(context);
      if (!authenticateBroadcastToken(context)) return;
      const { memberAuthId, role } = input;

      try {
        // Find broadcast and verify permissions
        const broadcast = await BroadcasterSchema.findById(
          context.req.broadcast.broadcastID
        );
        if (!broadcast) {
          return { message: "Broadcast not found", success: false };
        }

        const memberDetails = await UserSchema.findOne({
          authProviders: { $elemMatch: { oAuthID: memberAuthId } },
        });
        if (!memberDetails) {
          return { message: "Member not found", success: false };
        }

        // Verify broadcaster permission
        const isBroadcaster = broadcast.broadcastMembers.some(
          (member) =>
            member.primaryAuthId === context.req.broadcast.primaryAuthId &&
            member.role === "BROADCASTER"
        );
        if (!isBroadcaster) {
          return {
            message: "Only broadcasters can modify roles",
            success: false,
          };
        }

        // Find member to update
        const memberIndex = broadcast.broadcastMembers.findIndex(
          (member) => member.primaryAuthId === memberAuthId
        );

        if (memberIndex === -1) {
          return { message: "Member not found", success: false };
        }

        // Validate role changes
        const currentRole = broadcast.broadcastMembers[memberIndex].role;

        // Only allow specific role transitions
        const validTransitions = {
          MEMBER: ["CO_BROADCASTER"],
          CO_BROADCASTER: ["MEMBER"],
        };

        if (!validTransitions[currentRole]?.includes(role)) {
          return {
            message: "Invalid role transition",
            success: false,
          };
        }

        // Update role
        broadcast.broadcastMembers[memberIndex].role = role;
        await broadcast.save();

        // Clear cache
        const cacheKey = `broadcastMembers:${broadcast.broadcastName}`;
        await redisClient.del(cacheKey);

        return {
          message: `Successfully ${
            role === "CO_BROADCASTER" ? "promoted" : "demoted"
          } member`,
          success: true,
        };
      } catch (error) {
        console.error("Error in updateRole:", error);
        return {
          message: "Error updating role",
          success: false,
        };
      }
    },

    removeMember: async (_, { input }, context) => {
      authenticateUser(context);
      if (!authenticateBroadcastToken(context)) return;
      const { memberAuthId } = input;
      const { primaryAuthId, broadcastID } = context.req.broadcast;
      try {
        const broadcast = await BroadcasterSchema.findById(broadcastID);
        if (!broadcast) {
          return { message: "Broadcast not found", success: false };
        }

        // Verify broadcaster permission
        const isBroadcaster = broadcast.broadcastMembers.some(
          (member) =>
            member.primaryAuthId === primaryAuthId &&
            member.role === "BROADCASTER"
        );

        if (!isBroadcaster) {
          return {
            message: "Only broadcasters can remove members",
            success: false,
          };
        }

        // Check if trying to remove broadcaster
        const memberToRemove = broadcast.broadcastMembers.find(
          (member) => member.primaryAuthId === memberAuthId
        );

        if (!memberToRemove) {
          return { message: "Member not found", success: false };
        }

        if (memberToRemove.role === "BROADCASTER") {
          return {
            message: "Cannot remove the broadcaster",
            success: false,
          };
        }

        // Remove member
        broadcast.broadcastMembers = broadcast.broadcastMembers.filter(
          (member) => member.primaryAuthId !== memberAuthId
        );

        await broadcast.save();

        // Clear cache
        const cacheKey = `broadcastMembers:${broadcast.broadcastName}`;
        await redisClient.del(cacheKey);

        return {
          message: "Member removed successfully",
          success: true,
        };
      } catch (error) {
        console.error("Error in removeMember:", error);
        return {
          message: "Error removing member",
          success: false,
        };
      }
    },

    requestVideoCollaboration: async (_, { input }, context) => {
      authenticateUser(context);

      if (!context.req.broadcast) {
        return {
          message: "You are not authorized to send a collaboration request",
          success: false,
        };
      }
      const { broadcastID } = context.req.broadcast;
      const isBroadcaster = await BroadcasterSchema.findById(broadcastID).where(
        {
          broadcastMembers: {
            $elemMatch: {
              primaryAuthId: context.req.user.primaryAuthId,
              role: "BROADCASTER",
            },
          },
        }
      );

      if (!isBroadcaster) {
        return {
          message: "You are not authorized to send a collaboration request",
          success: false,
        };
      }

      const result = await broadcastService.requestVideoCollaboration(
        input,
        context.req.broadcast.broadcastID
      );

      if (result.success) {
        pubsub.publish("COLLABORATION_STATUS", {
          collaborationStatus: result.notificationData,
        });
      }

      return {
        message: result.message,
        success: result.success,
      };
    },

    joinBroadcast: async (_, { broadcastName }, context) => {
      authenticateUser(context);

      try {
        const broadcast = await BroadcasterSchema.findOne({ broadcastName });
        if (!broadcast) {
          return {
            message: "Broadcast not found",
            success: false,
          };
        }

        const userDetails = await UserSchema.findOne({
          authProviders: {
            $elemMatch: { oAuthID: context.req.user.sub.split("|")[1] },
          },
        });

        if (!userDetails) {
          return {
            message: "User not found",
            success: false,
          };
        }

        const userExists = broadcast.broadcastMembers.find(
          (member) => member.primaryAuthId === userDetails.primaryAuthId
        );

        if (userExists) {
          const token = jwt.sign(
            {
              primaryAuthId: userDetails.primaryAuthId,
              role: userExists.role,
              broadcastID: broadcast._id,
            },
            process.env.JWT_SECRET
          );
          return {
            message: token,
            success: true,
          };
        }

        broadcast.broadcastMembers.push({
          primaryAuthId: userDetails.primaryAuthId,
        });
        await broadcast.save();
        const token = jwt.sign(
          {
            primaryAuthId: userDetails.primaryAuthId,
            role: "MEMBER",
            broadcastID: broadcast._id,
          },
          process.env.JWT_SECRET
        );

        return {
          message: token,
          success: true,
        };
      } catch (e) {
        return {
          message: "An error occurred",
          success: false,
        };
      }
    },
    leaveBroadcast: async (_, { broadcastName }, context) => {
      authenticateUser(context);
      if (!context.req.broadcast) {
        return {
          message: "Broadcast not found",
          success: false,
        };
      }
      try {
        const broadcast = await BroadcasterSchema.findOne({ broadcastName });
        if (!broadcast) {
          return {
            message: "Broadcast not found",
            success: false,
          };
        }

        const userDetails = await UserSchema.findOne({
          authProviders: {
            $elemMatch: { oAuthID: context.req.user.sub.split("|")[1] },
          },
        });

        if (!userDetails) {
          return {
            message: "User not found",
            success: false,
          };
        }

        const userIndex = broadcast.broadcastMembers.findIndex(
          (member) => member.primaryAuthId === userDetails.primaryAuthId
        );

        if (userIndex === -1) {
          return {
            message: "User not found in broadcast",
            success: false,
          };
        }

        const leavingMember = broadcast.broadcastMembers[userIndex];

        // Handle broadcaster succession if the leaving member is the broadcaster
        if (leavingMember.role === "BROADCASTER") {
          // First try to find a co-broadcaster
          const newBroadcaster = broadcast.broadcastMembers.find(
            (member) =>
              member.primaryAuthId !== userDetails.primaryAuthId &&
              member.role === "CO_BROADCASTER"
          );

          if (newBroadcaster) {
            // Promote co-broadcaster to broadcaster
            newBroadcaster.role = "BROADCASTER";
          } else {
            // If no co-broadcaster, find the longest-serving member
            const remainingMembers = broadcast.broadcastMembers.filter(
              (member) => member.primaryAuthId !== userDetails.primaryAuthId
            );

            if (remainingMembers.length > 0) {
              // Sort by joinedAt date and promote the oldest member
              const oldestMember = remainingMembers.sort(
                (a, b) => a.joinedAt - b.joinedAt
              )[0];
              oldestMember.role = "BROADCASTER";
            } else {
              // If no other members, delete the broadcast
              await BroadcasterSchema.deleteOne({ _id: broadcast._id });
              return {
                message: "Broadcast deleted as no members remain",
                success: true,
              };
            }
          }
        }

        // Remove the leaving member
        broadcast.broadcastMembers.splice(userIndex, 1);
        await broadcast.save();

        // Clear broadcast cache
        const broadcastMemberKey = `broadcastMembers:${broadcastName}`;
        await redisClient.del(broadcastMemberKey);

        return {
          message: "Successfully left broadcast",
          success: true,
        };
      } catch (e) {
        console.error("Error in leaveBroadcast:", e);
        return {
          message: "An error occurred",
          success: false,
        };
      }
    },
  },

  Subscription: {
    collaborationStatus: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(["COLLABORATION_STATUS"]),
        (payload, variables) => {
          return (
            payload.collaborationStatus.receiverBroadcastID ===
            variables.collaboratorID
          );
        }
      ),
    },
  },

  BroadcastMemberPayload: {
    user: async (parent) => {
      const user = await UserSchema.findOne({
        primaryAuthId: parent.primaryAuthId,
      });
      return user;
    },
  },
};

export default BroadcastResolver;
