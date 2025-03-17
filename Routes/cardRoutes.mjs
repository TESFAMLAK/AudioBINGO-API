import express from 'express';
import bingoCards from '../constant/bingoCards.mjs';

const router = express.Router();

// Define the route to get bingo cards
router.get('/getCards', (req, res) => {
  try {
    res.json(bingoCards);
    console.log("Bingo cards sent successfully");
  } catch (error) {
    console.error("Error sending bingo cards:", error);
    res.status(500).json({ error: "Failed to send bingo cards" });
  }
});

export default router;
