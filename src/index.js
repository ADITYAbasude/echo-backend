import express from "express";
// Remove morgan import from here
import { ApolloServer } from "apollo-server-express";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { mergeTypeDefs, mergeResolvers } from "@graphql-tools/merge";
import { createServer } from "https";
import cors from "cors";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import graphqlUploadExpress from "graphql-upload/graphqlUploadExpress.mjs";
import dotenv from "dotenv";
import mongodbConnection from "./utils/mongodbConnection.js";
import UserSchema from "./api/graphql/schema/userSchema.js";
import BroadcastSchema from "./api/graphql/schema/broadcastSchema.js";
import UserResolver from "./api/graphql/resolvers/userResolver.js";
import BroadcastResolver from "./api/graphql/resolvers/broadcastResolver.js";
import authMiddleware from "./middlewares/authMiddleware.js";
import videoResolver from "./api/graphql/resolvers/videoResolver.js";
import broadcastMiddleware from "./middlewares/broadcastMiddleware.js";
import EngagementSchema from "./api/graphql/schema/engagementSchema.js";
import EngagementResolver from "./api/graphql/resolvers/engagementResolver.js";
import CollectionResolver from "./api/graphql/resolvers/collectionResolver.js";
import CollectionSchema from "./api/graphql/schema/collectionSchema.js";
import { VideosSchema } from "./models/broadcastModel.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("Nothing to get");
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Conditional dynamic import of morgan
if (process.env.NODE_ENV === "development") {
  const { default: morgan } = await import("morgan");
  app.use(morgan("dev"));
}

// Add urlencoded parser for NGINX RTMP callbacks
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Security middleware
app.use(helmet());

const allowedOrigins = [
  "http://localhost:3000",
  "https://192.168.0.112:3000",
  "https://echobroadcast.vercel.app",
  "https://echobroadcast-5nh78c88p-adityas-projects-256ac53f.vercel.app",
];

// Add Render's URL to allowed origins if available
if (process.env.RENDER_EXTERNAL_URL) {
  allowedOrigins.push(process.env.RENDER_EXTERNAL_URL);
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
  })
);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

mongodbConnection();

app.use(authMiddleware);
app.use(broadcastMiddleware);
app.use(graphqlUploadExpress());

const schema = makeExecutableSchema({
  typeDefs: mergeTypeDefs([
    UserSchema,
    BroadcastSchema,
    EngagementSchema,
    CollectionSchema,
  ]),
  resolvers: mergeResolvers([
    UserResolver,
    BroadcastResolver,
    videoResolver,
    EngagementResolver,
    CollectionResolver,
  ]),
});

// Add this before startApolloServer()
app.use((err, req, res, next) => {
  console.error('Error details:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });
  
  res.status(500).json({
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Add global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', {
    reason,
    promise
  });
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Give time for logs to be written
  setTimeout(() => process.exit(1), 1000);
});

async function startApolloServer() {
  let httpServer;

  if (process.env.NODE_ENV === "production") {
    httpServer = createServer(app);
    console.log("Starting server in production mode");
  } else {
    // Development SSL configuration
    const sslOptions = {
      key: readFileSync(path.join(__dirname, "../cert/key.pem")),
      cert: readFileSync(path.join(__dirname, "../cert/cert.pem")),
    };
    httpServer = createServer(sslOptions, app);
    console.log("Starting server in development mode");
  }

  const wsServer = new WebSocketServer({
    server: httpServer,
    path: "/graphql",
    cors: {
      origin: allowedOrigins,
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
    },
  });

  const serverCleanup = useServer(
    {
      schema,
    },
    wsServer
  );

  const server = new ApolloServer({
    schema,
    context: ({ req, res }) => {
      return { req, res, authorized: !!req.user };
    },
    plugins: [
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
    ],
    // Production Apollo Server settings
    csrfPrevention: {
      requestHeaders: ['x-apollo-operation-name', 'content-type']
    },
    cache: "bounded",
    introspection: process.env.NODE_ENV !== "production",
  });

  await server.start();
  server.applyMiddleware({ app, cors: true, path: "/graphql" });
  return new Promise((resolve, reject) => {
    httpServer.listen(PORT, "0.0.0.0", () => {
      const domain = process.env.RENDER_EXTERNAL_URL || `localhost:${PORT}`;
      const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
      const wsProtocol = process.env.NODE_ENV === "production" ? "wss" : "ws";

      console.log(
        `🚀 Server ready at https://localhost:${PORT}${server.graphqlPath}`
      );
      console.log(
        `🚀 Subscriptions ready at wss://localhost:${PORT}${server.graphqlPath}`
      );
      resolve({ server, httpServer });
    }).on("error", (error) => {
      console.error("Failed to start server:", error);
      reject(error)
    });
  });
}

app.use((err, req, res, next) => {  
  console.error(err.stack);
  res.status(500).send("Something broke!");
});


startApolloServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

app.post("/api/stream/end", async (req, res) => {
  try {
    const streamKey = req.body.name;

    console.log("Extracted stream key:", streamKey);

    if (!streamKey) {
      console.warn("No stream key found in request");
      return res
        .status(200)
        .json({
          message: "No stream key provided, but acknowledging callback",
        });
    }

    // Update the video status
    const result = await VideosSchema.findOneAndUpdate(
      { videoKey: streamKey },
      {
        isLive: false,
      },
      { new: true }
    );

    if (!result) {
      console.warn("No video found for stream key:", streamKey);
      return res
        .status(200)
        .json({ message: "Stream key not found, but acknowledging callback" });
    }

    res.status(200).json({
      message: "Stream ended successfully",
    });
  } catch (error) {
    console.error("Error in stream end handler:", error);
    // Always return 200 to NGINX even on error
    res.status(200).json({
      message: "Error processing stream end, but acknowledging callback",
      error: error.message,
    });
  }
});
