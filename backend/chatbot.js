require("dotenv").config();
const { GoogleGenAI, Type, FunctionCallingConfigMode } = require("@google/genai");
const { createTools } = require("./tools");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const CATEGORIES = ["Food & dining", "Transport", "Shopping", "Entertainment", "Other"];
const MAX_ROUNDS = 6; // max rounds of tool calls per question, so it can never loop forever

// The "menu" of tools Gemini is allowed to ask for.
// The descriptions matter: the model picks a tool by reading them.
const toolDeclarations = [
  {
    name: "getProfile",
    description: "The user's saved incomes (each with a monthly amount, plus the total) and their savings goals (each with a target). Check this before asking for income or goals.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "searchStrategies",
    description: "Searches a knowledge base of budgeting strategies (50/30/20, pay yourself first, envelope method, sinking funds, emergency fund, debt avalanche and snowball, 24-hour rule, subscription audit, no-spend challenge, automating savings). Use it whenever you suggest or explain a strategy, and base the explanation on what it returns. Write the query in English keywords.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "English keywords, e.g. 'overspending restaurants' or 'credit card debt'." },
      },
      required: ["query"],
    },
  },
  {
    name: "getSpendingByCategory",
    description: "Total amount spent per category, optionally for one month. Use for questions like 'where does my money go' or 'how much did I spend on food in September'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        month: { type: Type.STRING, description: "Month as YYYY-MM, e.g. 2026-09. Leave empty for all time." },
      },
    },
  },
  {
    name: "getTopMerchants",
    description: "The merchants where the user spent the most, optionally filtered by month and category.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        month: { type: Type.STRING, description: "Month as YYYY-MM. Leave empty for all time." },
        category: { type: Type.STRING, enum: CATEGORIES },
        limit: { type: Type.INTEGER, description: "How many merchants, 1 to 20. Default 5." },
      },
    },
  },
  {
    name: "getBudgetVsActual",
    description: "Compares the user's monthly budget per category (planned) with what they actually spent. Use for questions about budgets, overspending or 'am I on track'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        month: { type: Type.STRING, description: "Month as YYYY-MM. Leave empty for all time." },
      },
    },
  },
  {
    name: "getMonthlyTotals",
    description: "Total spent each month. Use for trends and comparing months.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "predictSavings",
    description: "Projects future savings from the user's total monthly income and their average spending, and for each saved goal how many months it would take if all savings went to it. Can simulate cutting one category by a percentage. Always use this for any savings, goal or 'what if' calculation instead of doing math yourself.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        monthlyIncome: { type: Type.NUMBER, description: "Monthly income in dollars, only if the user just gave one. Leave empty to use the saved income." },
        months: { type: Type.INTEGER, description: "How many months to project. Default 6." },
        reduceCategory: { type: Type.STRING, enum: CATEGORIES },
        reducePercent: { type: Type.NUMBER, description: "How much to cut that category, 0 to 100." },
      },
    },
  },
];

const SYSTEM_INSTRUCTION =
  "You are a budgeting assistant inside a personal spending tracker. " +
  "Answer ONLY using data returned by your tools. Never guess or invent numbers. " +
  "Never do any calculation yourself, not even an addition: " +
  "for savings, goals, cuts or 'what if' questions, call predictSavings (use reduceCategory and reducePercent to simulate a cut). " +
  "The user's incomes and savings goals may already be saved: check getProfile before asking for them. " +
  "Goals are independent: present each goal's timeline separately. " +
  "When you suggest or explain a budgeting strategy, call searchStrategies and base it on the result, " +
  "then connect it to the user's real numbers. " +
  "If something is still missing, ask for it, and mention they can save it in My budget. " +
  "Be efficient with tools: you can call several tools in the same turn. " +
  "For 'what should I cut' questions: get the spending (or budget vs actual) ONCE, " +
  "pick the 1 or 2 biggest flexible categories, and simulate at most 2 cuts with predictSavings. " +
  "If the data cannot answer the question, say so. " +
  "Give short, practical, encouraging suggestions based on their real spending. " +
  "Always reply in the language of the user's LATEST message, even if transaction names are in another language. " +
  "You are not a financial advisor; for big decisions about debt or investing, suggest talking to a professional.";

async function askChatbot(db, history) {
  const tools = createTools(db);

  // Turn the chat history from the frontend into Gemini's format
  const contents = history.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.text }],
  }));

  const toolLog = []; // everything the tools returned, used if we hit the limit

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const lastRound = round === MAX_ROUNDS;

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: toolDeclarations }],
        // Last round: no more tools allowed, the model MUST answer with what it has
        toolConfig: lastRound
          ? { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } }
          : undefined,
        temperature: 0.3,
      },
    });

    const calls = response.functionCalls;

    // No tool requested: this is the final answer
    if (!calls || calls.length === 0) {
      return response.text || "Sorry, I could not answer that.";
    }

    // Keep the model's turn (with its tool requests) in the conversation
    contents.push(response.candidates[0].content);

    // Run each requested tool with OUR code, then send the results back
    const results = [];
    for (const call of calls) {
      let result;
      if (!tools[call.name]) {
        result = { error: `Unknown tool ${call.name}` }; // model asked for something not on the menu
      } else {
        try {
          result = await tools[call.name](call.args || {});
        } catch (err) {
          console.error(`Tool ${call.name} failed:`, err.message);
          result = { error: "The database query failed." };
        }
      }
      console.log(`Chatbot used tool ${call.name}`, call.args || {});
      toolLog.push({ tool: call.name, args: call.args || {}, result });
      results.push({ functionResponse: { id: call.id, name: call.name, response: { result } } });
    }
    contents.push({ role: "user", parts: results });
  }

  // Limit reached: ask for a final answer from the data already collected,
  // in a fresh request with NO tools, so the model can only answer in text.
  console.log("Tool limit reached, asking for a final answer from the collected data");
  try {
    const final = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL,
      contents: [
        ...history.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.text }],
        })),
        {
          role: "user",
          parts: [{
            text:
              "Here is all the data your tools returned for my last question:\n" +
              JSON.stringify(toolLog).slice(0, 20000) +
              "\nAnswer my last question now using only this data. Do not ask for more data.",
          }],
        },
      ],
      config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.3 },
    });
    if (final.text) return final.text;
  } catch (err) {
    console.error("Final answer failed:", err.message);
  }

  return "Sorry, I couldn't finish that answer. Try asking something more specific.";
}

module.exports = { askChatbot };