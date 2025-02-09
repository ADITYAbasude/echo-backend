import mongoose, { Schema } from "mongoose";

const BroadcasterMember = new Schema({
  primaryAuthId: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ["BROADCASTER", "CO_BROADCASTER", "MEMBER"],
    default: "MEMBER",
  },
  joinedAt: {
    type: Date,
    default: Date.now
  }
});

const Video = new Schema({
  videoKey: {
    type: String,
    required: true,
  },
  broadcastID: {
    type: String,
    required: true,
  },
  primaryAuthId: { 
    type: String,
    required: true,
  },
  draft: {
    type: Boolean,
    default: true,
  },
  collaboration: {
    broadcastID: String,
    requestAccepted: {
      type: Boolean,
      default: false,
    },
  },
  metaData: {
    title: String,
    description: String,
    posterUrl: String,
    viewCount: {
      type: Number,
      default: 0,
    },
    video_codec: String,
    available_formats: [String],
    duration: Number
  },
  isLive: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

Video.index({
  'metaData.title': 'text',
  'metaData.description': 'text'
});

const Broadcaster = new Schema({
  primaryAuthId: {  
    type: String,
    required: true,
  },
  broadcastName: {
    type: String,
    required: true,
    unique: true,
  },
  aboutBroadcast: {
    type: String,
    required: true,
  },
  broadcastImg: {
    type: String,
    required: true,
  },
  broadcastMembers: [BroadcasterMember],
}, { timestamps: true });

Broadcaster.index({
  broadcastName: 'text',
  aboutBroadcast: 'text'
});

export const BroadcasterSchema = mongoose.model("broadcasts", Broadcaster);
export const VideosSchema = mongoose.model("videos", Video);
