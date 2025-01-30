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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("Nothing to get");
});

// Conditional dynamic import of morgan
if (process.env.NODE_ENV === 'development') {
  const { default: morgan } = await import('morgan');
  app.use(morgan("dev"));
}

app.use(express.json());

// Security middleware
app.use(helmet());

const allowedOrigins = [
  "http://localhost:3000",
  "https://192.168.0.112:3000",
  "https://echobroadcast.vercel.app",
  "https://echobroadcast-5nh78c88p-adityas-projects-256ac53f.vercel.app",
];

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

async function startApolloServer() {
  let httpServer;

  if (process.env.NODE_ENV === "production") {
    httpServer = createServer(app);
  } else {
    // Development SSL configuration
    const sslOptions = {
      key: readFileSync(path.join(__dirname, "../cert/key.pem")),
      cert: readFileSync(path.join(__dirname, "../cert/cert.pem")),
    };
    httpServer = createServer(sslOptions, app);
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
    csrfPrevention: true,
    cache: "bounded",
    introspection: process.env.NODE_ENV !== "production",
  });

  await server.start();
  server.applyMiddleware({ app });

  httpServer.listen(PORT, () => {
    console.log(
      `🚀 Server ready at https://localhost:${PORT}${server.graphqlPath}`
    );
    console.log(
      `🚀 Subscriptions ready at wss://localhost:${PORT}${server.graphqlPath}`
    );
  });
}

startApolloServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
