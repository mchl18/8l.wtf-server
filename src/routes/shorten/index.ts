import { Router, Request, Response } from "express";
import { database } from "src/lib/adapters";
import { getHostUrl } from "src/lib/utils";
import * as nanoid from "nanoid";

const router = Router();

// Shorten URL endpoint
router.post("/shorten", async (req: Request, res: Response) => {
  try {
    const { url, maxAge, seed, isEncrypted } = req.body;
    const hostUrl = getHostUrl();
    const db = await database;

    const urlsSet = isEncrypted ? "encrypted_urls" : "anonymous_urls";

    // Check for existing anonymous URLs
    const existingEntries = await db.smembers(urlsSet);

    for (const entry of existingEntries) {
      const [shortId, storedUrl] = entry.split("::");
      if (storedUrl === url) {
        const expiresAt = await db.get(`${shortId}:expires`);
        const metadata = await db.get<{ isEncrypted: boolean }>(
          `url:${shortId}:meta`
        );
        const expiresAtAsDate = expiresAt
          ? new Date(expiresAt as string)
          : undefined;
        if (expiresAtAsDate?.toString() === "Invalid Date") {
          continue;
        }
        res.json({
          shortId,
          fullUrl: `${hostUrl}?q=${shortId}`,
          deleteProxyUrl: `${hostUrl}/delete-proxy?q=${shortId}`,
          isEncrypted: metadata?.isEncrypted || false,
          seed: seed || undefined,
          expiresAt: expiresAtAsDate?.toISOString() || undefined,
        });
        return;
      }
    }

    if (!seed) {
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
    await db.set(`url:${shortId}:meta`, {
      seed: seed || undefined,
      isEncrypted,
    });
    await db.sadd(urlsSet, `${shortId}::${url}`);

    if (seed) {
      await db.sadd(`token:${seed}:urls`, shortId);
    }

    let expiresAt;
    if (maxAge) {
      if (typeof maxAge === "number" && maxAge > 0) {
        expiresAt = new Date(Date.now() + maxAge).toISOString();
        await db.set(shortId, url, { ex: Math.floor(maxAge) });
        await db.set(`${shortId}:expires`, expiresAt);
      } else {
        res.status(400).json({ error: "Invalid maxAge" });
        return;
      }
    } else {
      await db.set(shortId, url);
    }

    res.json({
      shortId,
      fullUrl: `${hostUrl}?q=${shortId}`,
      deleteProxyUrl: `${hostUrl}/delete-proxy?q=${shortId}`,
      isEncrypted: isEncrypted,
      seed,
      expiresAt,
    });
    return;
  } catch (error) {
    console.error("Error in /shorten:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
