import { Request, Response } from "express";
import { identify } from "./service";

export async function identifyController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { email, phoneNumber } = req.body;

    if (!email && !phoneNumber) {
      res
        .status(400)
        .json({ error: "At least one of email or phoneNumber is required" });
      return;
    }

    const result = await identify({ email, phoneNumber });
    res.status(200).json(result);
  } catch (err: any) {
    console.error("Error in /identify:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
