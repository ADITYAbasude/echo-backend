import { gql } from "apollo-server-express";

const UserSchema = gql`
  type AuthProvider {
    provider: String!
    oAuthID: String!
  }

  type User {
    _id: ID!
    email: String!
    username: String!
    profilePictureURL: String!
    authProviders: [AuthProvider]!
    primaryAuthId: String!
    createAt: String
  }

  type Settings {
    defaultQuality: String
    enableHotkeys: Boolean
    defaultVolume: Int
    defaultPlaybackSpeed: Float
    autoPlay: Boolean
  }

  input CreateUserInput {
    oAuthProvider: String!
    oAuthID: String!
    email: String!
    username: String!
    profilePictureURL: String!
  }

  type BroadcastDetails {
    _id: ID!
    primaryAuthId: ID!
    broadcastName: String!
    aboutBroadcast: String!
    broadcastImg: String!
    broadcastMembers: [BroadcasterMember]!
    createdAt: String
    videos: [Video]
    isJoined: Boolean
  }

  type Collection {
    savedVideos: [Video]
    stats: CollectionStats!
  }

  type CollectionStats {
    savedCount: Int!
    watchTime: Int!
    likedCount: Int!
    watchLaterCount: Int!
  }

  type Query {
    getUser(id: ID!): User!
    getSingleBroadcaster(broadcastName: String!): BroadcastDetails
    getVideoByID(videoID: ID!): Video
    getHomeContent: homeContentPayload
    getSettings: Settings
    searchQuery(query: String!): searchResultPayload!
  }

  type Mutation {
    createUser(input: CreateUserInput!): payload
    updateUserSettings(input: UpdateUserSettingsInput!): payload
  }

  type searchResultPayload {
    videos: [Video]
    broadcasters: [BroadcastDetails]
  }

  input UpdateUserSettingsInput {
    defaultQuality: String!
    enableHotkeys: Boolean!
    defaultVolume: Int!
    defaultPlaybackSpeed: Float!
    autoPlay: Boolean!
  }

  type payload {
    message: String!
    success: Boolean!
  }

  type homeContentPayload {
    carousel: [Video]
    content: [Video]
  }
`;

export default UserSchema;
