import { Router, Request, Response } from "express";
import { database } from "src/lib/adapters";
import { getHostUrl } from "src/lib/utils";

const router = Router();

// Shorten URL endpoint
router.post("/get-urls", async (req: Request, res: Response) => {
  try {
    const { seed } = req.body;

    if (!seed) {
      res.status(400).json({ error: "Seed is required" });
      return;
    }

    const hostUrl = getHostUrl();
    const db = await database;
    const shortIds = await db.smembers(`token:${seed}:urls`);
    const urls = [];

    for (const shortId of shortIds) {
      const metadata = await db.get<{ deleted: boolean; isEncrypted: boolean }>(
        `url:${shortId}:meta`
      );
      const isDeleted =
        metadata && typeof metadata === "object" && metadata.deleted === true;

      if (!isDeleted) {
        const encryptedUrl = await db.get(shortId);
        const expiresAt = await db.get(`${shortId}:expires`);
        const expiresAtAsDate = expiresAt ? new Date(expiresAt as string) : undefined;
        if (expiresAtAsDate?.toString() === "Invalid Date") {
          continue;
        }
        if (encryptedUrl) {
          urls.push({
            shortId,
            url: encryptedUrl,
            fullUrl: `${hostUrl}?q=${shortId}`,
            deleteProxyUrl: `${hostUrl}/delete-proxy?q=${shortId}`,
            isEncrypted: metadata?.isEncrypted || false,
            seed: seed || "",
            expiresAt: expiresAtAsDate?.toISOString() || undefined,
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

export default router;
