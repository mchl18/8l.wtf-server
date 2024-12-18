import { Express } from "express";

import { config } from "src/config";

import rootRoutes from "src/routes/root";
import shortenRoutes from "src/routes/shorten";
import getUrlRoutes from "src/routes/get-url";
import getUrlsRoutes from "src/routes/get-urls";
import deleteProxyRoutes from "src/routes/delete-proxy/delete-proxy";

export default (app: Express): void => {
  app.use(rootRoutes);
  app.use(config.apiPrefix, shortenRoutes);
  app.use(config.apiPrefix, getUrlRoutes);
  app.use(config.apiPrefix, getUrlsRoutes);
  app.use(config.apiPrefix, deleteProxyRoutes);
};
