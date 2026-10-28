require("dotenv").config();
const { GoogleGenAI, Type } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Privacy: hide account and card numbers (5+ digits in a row) before the
// text leaves the server, and cap the length to limit cost.
function maskSensitive(text) {
  return text.replace(/\d{5,}/g, "#####").slice(0, 30000);
}

// The JSON shape Gemini must answer with: a list of { date, description, amount }
const schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      date: { type: Type.STRING },
      description: { type: Type.STRING },
      amount: { type: Type.NUMBER },
    },
    required: ["date", "description", "amount"],
  },
};

const SYSTEM_INSTRUCTION =
  "You extract transactions from the text of a bank statement. " +
  "The statement can come from any Canadian bank and can be in French or English. " +
  "Only extract money going OUT of the account: purchases, payments, withdrawals, " +
  "cheques, fees, interest charged and transfers sent. " +
  "Do NOT extract deposits, money coming in, interest paid to the client, " +
  "opening or closing balances, running balances or totals. " +
  "For each transaction return: " +
  "date in YYYY-MM-DD format (use the statement period to find the year), " +
  "description as the merchant or a short label (for example 'ATM withdrawal'), " +
  "amount as a positive number with a dot for decimals (for example 47.82). " +
  "Never invent transactions. If the text contains no transactions, return an empty list.";

// True only for dates that exist on the calendar
function isRealDate(s) {
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

// Keep only transactions that make sense, and clean them up
function validateExtracted(results) {
  if (!Array.isArray(results)) return [];

  return results
    .filter(t =>
      t &&
      typeof t.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&        // date like 2026-09-14
      isRealDate(t.date) &&                        // and a real date (no Feb 30)
      typeof t.description === "string" &&
      t.description.trim().length > 0 &&
      typeof t.amount === "number" &&
      t.amount > 0 && t.amount < 100000
    )
    .map(t => ({
      date: t.date,
      description: t.description.trim().slice(0, 255), // fits VARCHAR(255)
      amount: Math.round(t.amount * 100) / 100,         // 2 decimals
    }));
}

// Sends the statement text to Gemini, retries once, never crashes
async function extractTransactions(pdfText) {
  const text = maskSensitive(pdfText);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL,
        contents: text,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0,
        },
      });

      return validateExtracted(JSON.parse(response.text));
    } catch (err) {
      console.error(`Extraction attempt ${attempt} failed:`, err.message);
    }
  }

  return []; // AI unavailable: nothing extracted
}

module.exports = { extractTransactions, validateExtracted, maskSensitive };