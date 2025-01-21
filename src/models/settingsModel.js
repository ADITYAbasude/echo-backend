import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema({
  primaryAuthId: {
    type: String,
    required: true,
    unique: true,
  },
  defaultQuality: {
    type: String,
    required: true,
    enum: ["high", "medium", "low"],
    default: "high"
  },
  defaultVolume: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  defaultPlaybackSpeed: {
    type: Number,
    min: 0.5,
    max: 2,
    default: 1
  },
  autoPlay: { 
    type: Boolean,
    default: true
  },
  enableHotkeys: {
    type: Boolean,
    default: true
  }
});

export default mongoose.model("Settings", settingsSchema);
