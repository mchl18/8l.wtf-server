import express, { Express } from "express";
import "express-async-errors";
import helmet from "helmet";
import cors from "cors";
import { getDatabase } from "./lib/adapters/index";
import { validateEncryptedSeedFormat, getHostUrl } from "./lib/utils";
import * as nanoid from "nanoid";
import QRCode from "qrcode";
import nocache from 'nocache';
import cookieParser from 'cookie-parser';

export const app = (app = express()): Express => {
  
  // const __filename = fileURLToPath(import.meta.url);
  // const __dirname = dirname(__filename);
  
  // const app = express();
  // const TRANSACTION_TIMEOUT = 5000;
  
  // Middleware
  app.use((req, res, next) => {
    if (!req.headers['content-type']) {
      req.headers['content-type'] = 'application/json';
    }
    next();
  });
  
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cors());
  app.use(helmet());
  app.use(nocache());
  app.use(cookieParser());
  
  // Shorten URL endpoint
  app.post("/api/shorten", async (req: express.Request, res: express.Response) => {
    try {
      const { url, maxAge, seed } = req.body;
      const hostUrl = getHostUrl();
      const db = await getDatabase();
  
      const urlsSet = seed ? "authenticated_urls" : "anonymous_urls";
  
      // Check for existing anonymous URLs
      if (!seed) {
        const existingEntries = await db.smembers("anonymous_urls");
        for (const entry of existingEntries) {
          const [shortId, storedUrl] = entry.split("::");
          if (storedUrl === url) {
            const expiresAt = await db.get(`${shortId}:expires`);
             res.json({
              shortId,
              fullUrl: `${hostUrl}/${shortId}`,
              deleteProxyUrl: `${hostUrl}/delete-proxy?id=${shortId}`,
              isEncrypted: false,
              expiresAt: expiresAt
                ? new Date(expiresAt as string).toISOString()
                : undefined,
            });
            return;
          }
        }
      }
  
      if (seed && !validateEncryptedSeedFormat(seed)) {
        res.status(401).json({ error: "Invalid seed" });
        return;
      }
  
      const idLength = parseInt(process.env.ID_LENGTH || "8");
      let shortId;
      let existingUrl;
  
      do {
        shortId = nanoid.nanoid(idLength);
        existingUrl = await db.get(shortId);
      } while (existingUrl);
  
      await db.set(`url:${shortId}:meta`, { authenticated: !!seed });
      await db.sadd(urlsSet, `${shortId}::${url}`);
  
      if (seed) {
        await db.sadd(`token:${seed}:urls`, shortId);
      }
  
      let expiresAt;
      if (maxAge && typeof maxAge === "number") {
        expiresAt = new Date(Date.now() + maxAge).toISOString();
        await db.set(shortId, url, { ex: Math.floor(maxAge) });
        await db.set(`${shortId}:expires`, expiresAt);
      } else {
        debugger
        await db.set(shortId, url);
      }
  
      res.json({
        shortId,
        fullUrl: `${hostUrl}/${shortId}`,
        deleteProxyUrl: `${hostUrl}/delete-proxy?id=${shortId}`,
        isEncrypted: !!seed,
        expiresAt,
      });
    } catch (error) {
      console.error("Error in /shorten:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  
  // Get URL endpoint
  app.post("/api/get-url", async (req: express.Request, res: express.Response) => {
    const { shortId, seed } = req.body;
  
    if (!shortId) {
      res.status(400).json({ error: "ShortId is required" });
      return;
    }
  
    const hostUrl = getHostUrl();
    const db = await getDatabase();
    let transaction = null;
  
    try {
      transaction = await db.transaction();
  
      const [meta, url, expiresAt, isUrlOwnedBySeed, encryptedUrl] =
        await Promise.all([
          transaction.get<{ authenticated: boolean }>(`url:${shortId}:meta`),
          transaction.get(shortId),
          transaction.get(`${shortId}:expires`),
          transaction.sismember(`token:${seed}:urls`, shortId),
          transaction.get(shortId),
        ]);
  
      const isAuthenticated = meta?.authenticated;
  
      if (!isAuthenticated) {
        if (!url) {
          await transaction.rollback();
          res.status(404).json({ error: "URL not found" });
          return;
        }
  
        await transaction.commit();
        res.json({
          shortId,
          url,
          fullUrl: `${hostUrl}/${shortId}`,
          deleteProxyUrl: `${hostUrl}/delete-proxy?id=${shortId}`,
          isEncrypted: false,
          expiresAt: expiresAt
            ? new Date(expiresAt as string).toISOString()
            : undefined,
        });
        return;
      }
  
      if (!seed || !validateEncryptedSeedFormat(seed)) {
        await transaction.rollback();
        res.status(401).json({ error: "Invalid seed" });
        return;
      }
  
      if (!isUrlOwnedBySeed || !encryptedUrl) {
        await transaction.rollback();
        res.status(404).json({ error: "URL not found" });
        return;
      }
  
      await transaction.commit();
      res.json({
        shortId,
        url: encryptedUrl,
        fullUrl: `${hostUrl}/${shortId}`,
        deleteProxyUrl: `${hostUrl}/delete-proxy?id=${shortId}`,
        isEncrypted: true,
        expiresAt: expiresAt
          ? new Date(expiresAt as string).toISOString()
          : undefined,
      });
    } catch (error) {
      console.error("Error in get-url:", error);
      if (transaction) {
        await transaction.rollback();
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });
  
  // Get URLs endpoint
  app.post("/api/get-urls", async (req: express.Request, res: express.Response) => {
    try {
      const { seed } = req.body;
  
      if (!seed) {
        res.status(400).json({ error: "Seed is required" });
        return;
      }
  
      const hostUrl = getHostUrl();
      const db = await getDatabase();
      const shortIds = await db.smembers(`token:${seed}:urls`);
      const urls = [];
  
      for (const shortId of shortIds) {
        const metadata = await db.get<{ deleted: boolean }>(
          `url:${shortId}:meta`
        );
        const isDeleted =
          metadata && typeof metadata === "object" && metadata.deleted === true;
  
        if (!isDeleted) {
          const encryptedUrl = await db.get(shortId);
          const expiresAt = await db.get(`${shortId}:expires`);
  
          if (encryptedUrl) {
            urls.push({
              shortId,
              url: encryptedUrl,
              fullUrl: `${hostUrl}/${shortId}`,
              deleteProxyUrl: `${hostUrl}/delete-proxy?id=${shortId}`,
              isEncrypted: true,
              expiresAt: expiresAt
                ? new Date(expiresAt as string).toISOString()
                : undefined,
            });
          }
        }
      }
  
      res.json({ urls });
    } catch (error) {
      console.error("Error in /get-urls:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  
  // QR Code endpoint
  app.post("/api/qr", async (req: express.Request, res: express.Response) => {
    try {
      const { text, options } = req.body;
  
      if (!text) {
        res.status(400).json({ error: "Text parameter is required" });
        return;
      }
  
      const qrOptions = {
        width: options?.width || 300,
        margin: options?.margin || 2,
        ...options,
      };
  
      const qrCodeDataUrl = await QRCode.toDataURL(text, qrOptions);
      res.json({ qrCode: qrCodeDataUrl });
    } catch (error) {
      console.error("Error generating QR code:", error);
      res.status(500).json({ error: "Failed to generate QR code" });
    }
  });
  
  // Delete proxy endpoint
  app.post("/api/delete-proxy", async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.body;
      const db = await getDatabase();
      const url = await db.get(id);
  
      if (!url) {
        res.status(404).json({ error: "URL not found" });
        return;
      }
  
      const response = await fetch(url, {
        method: "DELETE",
      });
  
      if (!response.ok) {
        res.status(500).json({ error: "Failed to call delete proxy" });
        return;
      }
  
      res.json({
        status: response.status,
        statusText: response.statusText,
        url,
        id,
      });
    } catch (error) {
      console.error("Error in /delete-proxy:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  
  // const PORT = process.env.PORT || 3003;
  // app.listen(PORT, () => {
  //   console.log(`Server running on port ${PORT}`);
  // });
  
  return app;
};
