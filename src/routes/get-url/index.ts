import { Router, Request, Response } from "express";
import { getDatabase } from "src/lib/adapters";
import { getHostUrl, validateEncryptedSeedFormat } from "src/lib/utils";

const router = Router();

// Shorten URL endpoint
router.post(
  "/get-url",
  async (req: Request, res: Response) => {
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
          transaction.get<{ isEncrypted: boolean }>(`url:${shortId}:meta`),
          transaction.get(shortId),
          transaction.get(`${shortId}:expires`),
          transaction.sismember(`token:${seed}:urls`, shortId),
          transaction.get(shortId),
        ]);

      const isEncrypted = meta?.isEncrypted;

      if (!isEncrypted) {
        if (!url) {
          await transaction.rollback();
          res.status(404).json({ error: "URL not found" });
          return;
        }

        await transaction.commit();
        res.json({
          shortId,
          url,
          fullUrl: `${hostUrl}?q=${shortId}`,
          deleteProxyUrl: `${hostUrl}/delete-proxy?q=${shortId}`,
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
        fullUrl: `${hostUrl}?q=${shortId}`,
        deleteProxyUrl: `${hostUrl}/delete-proxy?q=${shortId}`,
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
  }
);

export default router;
