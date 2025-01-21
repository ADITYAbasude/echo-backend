import { BroadcasterSchema, VideosSchema } from "../../models/broadcastModel.js";
import UserSchema from "../../models/userModel.js";

class UserService {
  async createUser(input) {
    const { oAuthProvider, oAuthID, email, username, profilePictureURL } =
      input;

    if (!oAuthID) {
      throw new Error("oAuthID is required and cannot be null or undefined");
    }

    let user = await UserSchema.findOne({ email });

    if (user) {
      const hasProvider = user.authProviders.some(
        (provider) => provider.oAuthID === oAuthID
      );

      if (!hasProvider) {
        user.authProviders.push({
          provider: oAuthProvider,
          oAuthID: oAuthID,
        });
        await user.save();
      }

      await UserSchema.updateOne(
        { _id: user._id, email },
        {
          $set: {
            profilePictureURL,
            username,
          },
        }
      );
      return { message: "User updated successfully", success: true };
    }

    await UserSchema.create({
      email,
      username,
      profilePictureURL,
      primaryAuthId: oAuthID,
      authProviders: [
        {
          provider: oAuthProvider,
          oAuthID: oAuthID,
        },
      ],
    });
    return { message: "User created successfully", success: true };
  }

  async getUserById(id) {
    return UserSchema.findOne({
      $or: [{ primaryAuthId: id }, { "authProviders.oAuthID": id }],
    });
  }

  async getSingleBroadcaster(broadcastName) {
    return BroadcasterSchema.findOne({ broadcastName });
  }

  async getHomeContent() {
    const carouselShowingData = await VideosSchema.aggregate([
      {
        $sample: { size: 5 },
      },
    ]);
    const contentShowingData = await VideosSchema.aggregate([
      { $sort: { _id: -1 } }, // Sort by newest first
      { $limit: 10 },
    ]);

    return { carousel: carouselShowingData, content: contentShowingData };
  }

  async getBroadcastVideos(broadcastId) {
    return VideosSchema.find({ broadcastId });
  }

}

export default new UserService();
