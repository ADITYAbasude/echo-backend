import { gql } from "apollo-server-express";

const EngagementSchema = gql`
  type ViewUpdateResponse {
    success: Boolean!
    message: String
    currentViews: Int
    lastViewedAt: String
  }

  type BroadcastEngagement {
      views: Int
      date: String
  }

  type LocationData {
    country: String
    views: Int
  }

  type DeviceData {
    date: String
    desktop: Int
    mobile: Int
  }

  type BroadcastAnalytics {
    broadcastEngagement: [BroadcastEngagement]     
    location: [LocationData]
    deviceAnalytics: [DeviceData]
    message: String!
    status: Boolean!
  }

  type Query {
    getAnalyticsOfBroadcast: BroadcastAnalytics
  }

  type Mutation {
    updateViewsOfVideo(videoID: ID!): ViewUpdateResponse
  }
`;

export default EngagementSchema;
