import { gql } from "apollo-server-express";

const BroadcastSchema = gql`
  scalar Upload
  scalar JSON

  type BroadcasterAccount {
    _id: ID!
    primaryAuthId: ID!
    broadcastName: String!
    aboutBroadcast: String!
    broadcastImg: String!
    broadcastMembers: [BroadcasterMember]!
    createdAt: String
  }

  type Video {
    _id: ID!
    isLive: Boolean
    metaData: MetaData
    videoKey: String!
    primaryAuthId: String!
    broadcastID: String!
    broadcast: BroadcasterAccount
    collaboration: Collaboration
    videoAddBy: User
    userSettings: Settings
    draft: Boolean
    createdAt: String!
  }

  type MetaData {
    title: String
    description: String
    posterUrl: String
    viewCount: Int!
    video_codec: String
    available_formats: [String]
    duration: Int
    engagement: Int!
  }

  type BroadcasterMember {
    primaryAuthId: ID!
    role: String!
  }

  enum Role {
    BROADCASTER
    CO_BROADCASTER
    MEMBER
  }

  type Query {
    verifyBroadcastAccount: verifyBroadcastAccountPayload!
    getBroadcastMembers(broadcastName: String!): [BroadcastMemberPayload]
    getBroadcastVideos(broadcastName: String!): [Video]
    getBroadcasters(broadcastName: String!): [BroadcasterAccount]
    getBroadcaster: BroadcasterAccount
    getBroadcastVideosByToken: [Video]
    getVideoSignedUrl(videoID: ID!): hlsSignedUrlPayload
    getLiveStreamStatus: liveStreamPayload!
  }

  type Mutation {
    createBroadcaster(input: createBroadcasterInput!): payload!
    updateBroadcast(input: updateBroadcastInput!): payload!
    addMember(input: addMemberInput!): payload!
    updateRole(input: updateRoleInput!): payload!
    removeMember(input: removeMemberInput!): payload!
    getVideoUploadUrl: signedUrlPayload
    uploadVideo(videoId: ID): payloadWithID!
    storeVideoDetails(input: storeVideoDetailsInput!): payload!
    deleteVideo(input: deleteVideoInput!): payload!
    requestVideoCollaboration(input: CollaborationRequest!): payload!
    respondToCollaboration(input: CollaborationResponse!): payload!
    joinBroadcast(broadcastName: String!): payload!
    leaveBroadcast(broadcastName: String!): payload!
    streamBroadcast(input: StreamBroadcastInput!): streamBroadcastPayload!
    endBroadcastStream: payload!
  }

  type Subscription {
    videoUploadingAndTranscodingStatus(userId: ID!): VideoStatus!
    # //TODO: do it in future
    collaborationStatus(collaboratorID: ID!): CollaborationStatus!
  }

  enum VerifyStatus {
    VERIFIED
    UNVERIFIED
  }

  enum CollaborationRequestStatus {
    PENDING
    ACCEPTED
    REJECTED
  }

  type streamBroadcastPayload {
    message: String
    success: Boolean!
    streamKey: String
  }

  type requestStatus {
    status: CollaborationRequestStatus!
    broadcastID: ID!
    senderBroadcastID: ID!
  }

  type Collaboration {
    broadcastID: ID
    requestAccepted: Boolean
    broadcast: BroadcasterAccount
  }

  type verifyBroadcastAccountPayload {
    status: VerifyStatus!
    message: String
    success: Boolean!
    broadcastName: String
    broadcastID: ID
  }

  type VideoStatus {
    status: String!
    userId: ID
    videoId: ID
  }

  type BroadcastMemberPayload {
    primaryAuthId: ID
    role: Role
    user: User
  }

  input StreamBroadcastInput {
    title: String!
    description: String!
    poster: Upload!
  }

  input deleteVideoInput {
    videoID: ID!
    auth0ID: ID!
  }

  input createBroadcasterInput {
    auth0ID: String!
    broadcastName: String!
    aboutBroadcast: String!
    broadcastImg: Upload!
  }

  input addMemberInput {
    broadcastID: ID!
    primaryAuthId: String!
  }

  input updateRoleInput {
    memberAuthId: ID!
    role: Role!
  }

  input removeMemberInput {
    memberAuthId: ID!
  }

  input storeVideoDetailsInput {
    videoTitle: String!
    videoDescription: String!
    videoPoster: Upload!
    videoID: ID!
    videoDuration: Int!
  }

  input updateBroadcastInput {
    broadcastName: String
    aboutBroadcast: String
    broadcastImg: Upload
  }

  input collaborationInput {
    broadcastID: ID!
  }

  type payloadWithID {
    message: String
    success: Boolean!
    id: ID
  }

  input CollaborationRequest {
    collaboratorID: ID!
    videoID: ID!
  }

  input CollaborationResponse {
    videoID: ID!
    status: CollaborationRequestStatus!
  }

  type CollaborationStatus {
    status: CollaborationRequestStatus!
    videoID: ID!
    senderBroadcastName: String!
    receiverBroadcastID: ID!
  }

  type signedUrlPayload {
    signedUrl: String
    videoID: ID
    success: Boolean!
  }

  type SegmentUrl {
    name: String!
    url: String!
  }

  type ResolutionUrls {
    masterUrl: String!
    segments: [SegmentUrl!]!
  }

  type hlsSignedUrlPayload {
    resolutions: JSON
    initialResolution: String
    success: Boolean!
  }

  type liveStreamPayload {
    isLive: Boolean
    streamTitle: String
    viewerCount: Int
    startedAt: String
    posterUrl: String
    streamKey: String
    success: Boolean!
    message: String!
  }
`;

export default BroadcastSchema;
