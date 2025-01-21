import { BroadcasterSchema } from "../models/broadcastModel.js";

export const authenticateBroadcastToken = async (context) => {
  if (!context.req.broadcast) {
    throw new Error("Unauthorized Access");
  }
  const { primaryAuthId, broadcastID } = context.req.broadcast;
  if (!primaryAuthId || !broadcastID) {
    throw new Error("Unauthorized Access");
  }

  // check in db that they are a members of the broadcast or not.
  const isPartOfBroadcast = await BroadcasterSchema.findById(broadcastID).where(
    {
      broadcastMembers: {
        $elemMatch: {
          primaryAuthId: primaryAuthId,
        },
      },
    }
  );

  if (!isPartOfBroadcast) {
    throw new Error("Unauthorized Access");
  }
  return true;
};
