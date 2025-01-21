export const authenticateUser = (context) => {
  const authorization = context.req.headers.authorization;
  if (!authorization || !context.req.user) {
    return { message: "Unauthorized", success: false };
  }
  return null;
};
