import mongoose, { Schema } from "mongoose";

const Collection = new Schema(
  {
    primaryAuthId: {
      type: String,
      required: true,
      unique: true,
    },
    watchLater: [
      {
        videoId: {
          type: Schema.Types.ObjectId,
          ref: "videos",
        },
        broadcast: {
          type: Schema.Types.ObjectId,
          ref: "broadcasts",
        },
        addedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    watchHistory: [
      {
        videoId: {
          type: Schema.Types.ObjectId,
          ref: "videos",
        },
        watchedAt: {
          type: Date,
          default: Date.now,
        },
        watchDuration: {
          type: Number,
          default: 0,
        },
      },
    ],
  },
  { timestamps: true }
);


const CollectionSchema = mongoose.model("collections", Collection);
export default CollectionSchema;
