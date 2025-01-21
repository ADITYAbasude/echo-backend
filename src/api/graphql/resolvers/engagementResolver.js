import redisClient from "../../../config/redisConfig.js";
import { VideosSchema } from "../../../models/broadcastModel.js";
import requestIp from "request-ip";
import { UAParser } from "ua-parser-js";
import { EngagementModel } from "../../../models/engagementModel.js";
import axios from "axios";

const VIEW_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds

const EngagementResolver = {
  Mutation: {
    updateViewsOfVideo: async (_, { videoID }, { req }) => {
      try {
        const viewerIP = requestIp.getClientIp(req);
        const ua = UAParser(req.headers["user-agent"]);

        const clientIP = viewerIP?.replace("::ffff:", "") || "127.0.0.1";

        // Check rate limiting using Redis
        const viewKey = `view:${videoID}:${clientIP}`; // Changed viewerIP to clientIP
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
              // Changed cleanIP to clientIP
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
          device: ua.device.type || "UNKNOWN",
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
