import redisClient from "../../../config/redisConfig.js";
import { VideosSchema } from "../../../models/broadcastModel.js";
import requestIp from "request-ip";
import { UAParser } from "ua-parser-js";
import { EngagementModel } from "../../../models/engagementModel.js";
import axios from "axios";
import { authenticateUser } from "../../../utils/authenticatUser.js";
import { authenticateBroadcastToken } from "../../../utils/authenticateBroadcastToken.js";

const VIEW_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds

const EngagementResolver = {
  Query: {
    getAnalyticsOfBroadcast: async (_, __, context) => {
      try {
        authenticateUser(context);
        if (!(await authenticateBroadcastToken(context))) {
          return {
            message: "Invalid broadcast token",
            status: false,
          };
        }

        const getViews = await EngagementModel.aggregate([
          { $match: { broadcastID: context.req.broadcast.broadcastID } },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$lastViewedAt" },
              },
              views: { $sum: 1 },
            },
          },
          {
            $sort: { _id: 1 },
          },
        ]);

        const locations = await EngagementModel.aggregate([
          { $match: { broadcastID: context.req.broadcast.broadcastID } },
          {
            $group: {
              _id: "$country",
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              country: "$_id",
              views: "$count",
              _id: 0,
            },
          },
          {
            $sort: { views: -1 },
          },
          {
            $limit: 10,
          },
        ]);

        const deviceAnalytics = await EngagementModel.aggregate([
          { $match: { broadcastID: context.req.broadcast.broadcastID } },
          {
            $group: {
              _id: {
                date: { $dateToString: { format: "%Y-%m-%d", date: "$lastViewedAt" } },
                device: { $cond: [{ $eq: ["$device", "mobile"] }, "mobile", "desktop"] }
              },
              count: { $sum: 1 }
            }
          },
          {
            $group: {
              _id: "$_id.date",
              deviceCounts: {
                $push: {
                  device: "$_id.device",
                  count: "$count"
                }
              }
            }
          },
          {
            $project: {
              date: "$_id",
              desktop: {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$deviceCounts",
                        as: "item",
                        cond: { $eq: ["$$item.device", "desktop"] }
                      }
                    },
                    as: "filtered",
                    in: "$$filtered.count"
                  }
                }
              },
              mobile: {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$deviceCounts",
                        as: "item",
                        cond: { $eq: ["$$item.device", "mobile"] }
                      }
                    },
                    as: "filtered",
                    in: "$$filtered.count"
                  }
                }
              }
            }
          },
          {
            $sort: { date: 1 }
          }
        ]);

        return {
          broadcastEngagement: getViews.map((view) => ({
            views: view.views,
            date: view._id,
          })),
          location: locations,
          deviceAnalytics: deviceAnalytics.map(item => ({
            date: item.date,
            desktop: item.desktop || 0,
            mobile: item.mobile || 0
          })),
          message: "Broadcast analytics fetched successfully",
          status: true,
        };
      } catch (error) {
        console.error("Error in getAnalyticsOfBroadcast:", error);
        return {
          message: error.message,
          status: false,
        };
      }
    },
  },
  Mutation: {
    updateViewsOfVideo: async (_, { videoID }, { req }) => {
      try {
        const viewerIP = requestIp.getClientIp(req);
        const ua = UAParser(req.headers["user-agent"]);

        const clientIP = viewerIP?.replace("::ffff:", "") || "127.0.0.1";

        // Check rate limiting using Redis
        const viewKey = `view:${videoID}:${clientIP}`;
        const lastView = await redisClient.get(viewKey);
        if (lastView) {
          const timeSinceLastView = Date.now() - parseInt(lastView);
          if (timeSinceLastView < VIEW_TIMEOUT) {
            return {
              success: false,
              lastViewedAt: lastView,
            };
          }
        }

        let geoData = {
          data: {
            country_name: "Unknown",
            city: "Unknown",
            region: "Unknown",
          },
        };

        if (clientIP !== "127.0.0.1" && clientIP !== "localhost") {
          // Changed cleanIP to clientIP
          try {
            geoData = await axios.get(`https://ipapi.co/${clientIP}/json/`, {
              timeout: 5000, // 5 second timeout
              headers: {
                "User-Agent": "Mozilla/5.0", // Some API services require a user agent
              },
            });
          } catch (geoError) {
            console.error("Geolocation fetch error:", geoError);
          }
        }

        // Update view count atomically
        const videoData = await VideosSchema.findOneAndUpdate(
          { _id: videoID },
          {
            $inc: { "metaData.viewCount": 1 },
          },
          {
            returnDocument: "after",
            projection: { broadcastID: 1 },
          }
        );

        await EngagementModel.create({
          broadcastID: videoData.broadcastID,
          videoID: videoID,
          viewerIP: clientIP,
          country: geoData.data.country_name,
          city: geoData.data.city,
          region: geoData.data.region,
          timezone: new Date().getTimezoneOffset(),
          lastViewedAt: new Date(),
          device: ua.device.type || "desktop",
          browser: ua.browser.name || "UNKNOWN",
          os: ua.os.name || "UNKNOWN",
        });

        // Set rate limit
        await redisClient.set(viewKey, Date.now(), "PX", VIEW_TIMEOUT);

        return {
          success: true,
          lastViewedAt: new Date().toISOString(),
        };
      } catch (error) {
        console.error("Error updating video views:", error);
        return {
          success: false,
          message: error.message,
          currentViews: null,
          lastViewedAt: null,
        };
      }
    },
  },
};

export default EngagementResolver;
