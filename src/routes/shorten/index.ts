import { Router, Request, Response } from "express";
// import nocache from 'nocache';
import { getDatabase } from "src/lib/adapters";
import { getHostUrl, validateEncryptedSeedFormat } from "src/lib/utils";
import * as nanoid from "nanoid";

// import cacheForever from 'src/middleware/cache-forever';

const router = Router();

// Shorten URL endpoint
router.post("/shorten", async (req: Request, res: Response) => {
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
            fullUrl: `${hostUrl}?q=${shortId}`,
            deleteProxyUrl: `${hostUrl}/delete-proxy?q=${shortId}`,
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
      await db.set(shortId, url);
    }

    res.json({
      shortId,
      fullUrl: `${hostUrl}?q=${shortId}`,
      deleteProxyUrl: `${hostUrl}/delete-proxy?q=${shortId}`,
      isEncrypted: !!seed,
      expiresAt,
    });
    return;
  } catch (error) {
    console.error("Error in /shorten:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
