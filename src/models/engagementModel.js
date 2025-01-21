import mongoose from "mongoose";

const Engagement = new mongoose.Schema({
    broadcastID: {
        type: String,
        required: true,
    },
    videoID: {
        type: String,
        required: true,
    },
    viewerIP: {
        type: String,
        required: true,
    },
    country: {
        type: String,
    },
    city: {
        type: String,
    },
    region: {
        type: String,
    },
    timezone: {
        type: String,
    },
    lastViewedAt: {
        type: Date,
        default: Date.now,
    },
    device: {
        type: String,
    },
    browser: {
        type: String,
    },
    os: {
        type: String,
    },
}, { timestamps: true });


export const EngagementModel = mongoose.model("Engagement", Engagement);
