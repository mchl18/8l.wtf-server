import express, { Express } from "express";
import "express-async-errors";
import helmet from "helmet";
import cors from "cors";
import nocache from "nocache";
import cookieParser from "cookie-parser";
import bootstrap from "./routes/route";

export const app = (app = express()): Express => {
  // Middleware
  app.use((req, res, next) => {
    if (!req.headers["content-type"]) {
      req.headers["content-type"] = "application/json";
    }
    next();
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cors());
  app.use(helmet());
  app.use(nocache());
  app.use(cookieParser());

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  bootstrap(app);

  return app;
};
