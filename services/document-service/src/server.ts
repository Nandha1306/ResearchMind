import dotenv from "dotenv";

dotenv.config();

import app from "./app";
import { connectDB } from "./config/db";
import logger from "./utils/logger";

const PORT =
  process.env.PORT || 5003;

/** Start document service. */
const startServer = async () => {
  await connectDB();

  app.listen(PORT, () => {
    logger.info(
      `Document Service running on port ${PORT}`
    );
  });
};

startServer();