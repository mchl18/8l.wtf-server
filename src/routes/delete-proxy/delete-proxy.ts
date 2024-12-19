import { Router, Request, Response } from "express";
// import nocache from 'nocache';
import { database } from "src/lib/adapters";
// import cacheForever from 'src/middleware/cache-forever';

const router = Router();

// Shorten URL endpoint
router.post("/delete-proxy", async (req: Request, res: Response) => {
  try {
    const { id } = req.body;
    const db = await database;
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

export default router;
