require("dotenv").config();
const { GoogleGenAI, Type } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const CATEGORIES = ["Food & dining", "Transport", "Shopping", "Entertainment", "Other"];

// The JSON shape Gemini must answer with
const schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      index: { type: Type.INTEGER },
      category: { type: Type.STRING, enum: CATEGORIES },
    },
    required: ["index", "category"],
  },
};

// Checks Gemini's answer and keeps only valid results
function validate(results, count) {
  const categories = new Array(count).fill(null);

  if (!Array.isArray(results)) return categories;

  for (const r of results) {
    const validIndex = Number.isInteger(r.index) && r.index >= 0 && r.index < count;
    const validCategory = CATEGORIES.includes(r.category);
    if (validIndex && validCategory) categories[r.index] = r.category;
  }

  return categories;
}

// Sends transactions to Gemini, retries once, never crashes
async function categorizeTransactions(transactions) {
  const list = transactions
    .map((t, i) => `${i}: ${t.description}, ${t.amount}`)
    .join("\n"); // one transaction per line

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL,
        contents: list,
        config: {
          systemInstruction:
            "You categorize bank transactions from any Canadian bank account. " +
            "Descriptions can be in French or English. " +
            "Use ONLY these categories: Food & dining, Transport, Shopping, Entertainment, Other. " +
            "Return exactly one result for every index you receive. " +
            "If you are not sure, use Other. " +
            "Examples: 'STM', 'CHRONO', 'UBER TRIP', 'REM' is Transport. 'UBER EATS' is Food & dining. " +
            "'Jean Coutu' or 'Aritzia' is Shopping. 'Transfer sent' or 'ATM withdrawal' is Other.",
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0,
        },
      });

      return validate(JSON.parse(response.text), transactions.length);
    } catch (err) {
      console.error(`Gemini attempt ${attempt} failed:`, err.message);
    }
  }

  return new Array(transactions.length).fill(null); // AI unavailable
}

module.exports = { categorizeTransactions };

// Quick test: only runs with "node categorizer.js"
if (require.main === module) {
  categorizeTransactions([
    { description: "Achat Interac Aritzia", amount: 76.89 },
    { description: "STM CHRONO", amount: 3.75 },
    { description: "NETFLIX.COM", amount: 16.99 },
  ]).then(console.log);
}