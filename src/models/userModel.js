import mongoose, { Schema } from "mongoose";

const AuthProviderSchema = new Schema({
  provider: {
    type: String,
    required: true
  },
  oAuthID: {
    type: String,
    required: true
  }
});

const User = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  username: {
    type: String,
    required: true,
  },
  profilePictureURL: {
    type: String,
    required: true,
  },
  authProviders: [AuthProviderSchema],
  primaryAuthId: {
    type: String,
    required: true,
    unique: true,
  }
});

// Create compound index for provider and oAuthID
User.index({ 'authProviders.provider': 1, 'authProviders.oAuthID': 1 }, { unique: true, sparse: true });

const UserSchema = mongoose.model("users", User);

// Drop any existing oAuthID index if it exists
UserSchema.collection.dropIndex('oAuthID_1')
  .catch(err => {
    // Ignore error if index doesn't exist
    if (err.code !== 27) {
      console.error('Error dropping index:', err);
    }
  });

export default UserSchema;