import express from "express";
import dotenv from "dotenv";
import { initDB } from "./schema";
import { identifyController } from "./controller";

dotenv.config();

const app = express();
app.use(express.json());

// Health check
app.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

// Identity resolution endpoint
app.post("/identify", identifyController);

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await initDB();
    console.log("Database initialised – Contact table ready");
  } catch (err) {
    console.error("Failed to initialise database:", err);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
})();
