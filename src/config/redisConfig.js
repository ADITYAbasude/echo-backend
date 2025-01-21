import redis from "redis";
import dotenv from "dotenv";

dotenv.config();

const redisClient = redis.createClient({
    url: process.env.REDIS_URL
});

redisClient.connect().then(() => {
    console.log("Connected to Redis");
}).catch((err) => {
    console.error("Error connecting to Redis", err);
});

export default redisClient;