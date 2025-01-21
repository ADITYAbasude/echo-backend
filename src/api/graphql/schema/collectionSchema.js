import { gql } from "apollo-server-express";

const CollectionSchema = gql`
  type Collection {
    watchLater: [WatchLater]
    watchHistory: [WatchHistoryEntry]
    stats: CollectionStats!
  }

  type WatchLater {
    _id: ID!
    video: Video!
    addedAt: String
  }

  type WatchHistoryEntry {
    _id: ID!
    video: Video!
    watchedAt: String
    watchDuration: Int
  }

  type CollectionStats {
    watchTime: Int!
    watchLaterCount: Int!
  }

  type CollectionMutationResponse {
    message: String!
    success: Boolean!
  }

  type Query {
    getCollection: Collection
  }

  type Mutation {
    addToWatchLater(videoId: ID!): CollectionMutationResponse!
    removeFromWatchLater(videoId: ID!): CollectionMutationResponse!
  }
`;

export default CollectionSchema;