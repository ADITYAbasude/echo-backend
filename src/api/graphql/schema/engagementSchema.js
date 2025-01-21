import { gql } from "apollo-server-express";

const EngagementSchema = gql`
  type ViewUpdateResponse {
    success: Boolean!
    message: String
    currentViews: Int
    lastViewedAt: String
  }

  type Mutation {
    updateViewsOfVideo(videoID: ID!): ViewUpdateResponse
  }
`;

export default EngagementSchema;
