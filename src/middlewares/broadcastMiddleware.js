import jwt from "jsonwebtoken";

const broadcastMiddleware = async (req, res, next) => {
  const  token  = req.headers.token;
  if (!token) {
    req.broadcast = null;
    return next()
  }

  jwt.verify(token.split(" ")[1], process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      req.broadcast = null
      return next()
    }
    req.broadcast = decoded;
    return next();
  });
};

export default broadcastMiddleware;
