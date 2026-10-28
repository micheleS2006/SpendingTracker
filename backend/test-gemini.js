require("dotenv").config();                         // Loads .env so process.env.GEMINI_API_KEY has a value.
const { GoogleGenAI } = require("@google/genai");    // Imports the Gemini client from the library you installed.

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });  // Creates a client that’s logged in with your key.

async function main() {                              // An async function, because calling Gemini takes time and you need await.
  const response = await ai.models.generateContent({ // Sends the request: model (which AI), contents (the data, i.e. the user prompt), and systemInstruction (the rules it must follow).
    model: process.env.GEMINI_MODEL,
    contents: "Classify this bank transaction: 'Achat Interac Aritzia, 76.89'",
    config: {
      systemInstruction:
        "You classify bank transactions. Answer with exactly one of: " +
        "Food & dining, Transport, Shopping, Entertainment, Other.",
    },
  });

  console.log(response.text);                        // Prints the model’s text answer.
}

main();