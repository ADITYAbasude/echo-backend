import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const mongodbConnection = async () => {
  mongoose
    .connect(process.env.DB_URL)
    .then(() => {
      console.log("Connected to MongoDB");
    })
    .catch((err) => {
      console.log("Error connecting to MongoDB: ", err);
    });
};


export default mongodbConnection;