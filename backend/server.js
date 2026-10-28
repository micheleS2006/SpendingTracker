const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const multer = require("multer");
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
require("dotenv").config();
const { categorizeTransactions } = require("./categorizer");
const { extractTransactions } = require("./extractor");
const { getCategory } = require("./rules");
const { askChatbot } = require("./chatbot");
const { STRATEGIES } = require("./strategies");

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_CA_CERT ? { ca: process.env.DB_CA_CERT } : undefined
});

// Incomes and savings goals: two independent lists (created automatically,
// locally and on Aiven). A one-time step moves the old single income/goal over.
async function setupProfileTables() {
  const q = (sql, params) => db.promise().query(sql, params);
  try {
    await q(`CREATE TABLE IF NOT EXISTS incomes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      amount DECIMAL(10,2) NOT NULL
    )`);
    await q(`CREATE TABLE IF NOT EXISTS goals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      amount DECIMAL(10,2) NOT NULL
    )`);

    // Old version stored one income and one goal in "profile": copy them once
    const [old] = await q("SHOW TABLES LIKE 'profile'");
    if (old.length) {
      const [[p]] = await q("SELECT * FROM profile WHERE id = 1");
      const [[{ n }]] = await q("SELECT COUNT(*) AS n FROM incomes");
      const [[{ g }]] = await q("SELECT COUNT(*) AS g FROM goals");
      if (p && p.monthly_income && n === 0) await q("INSERT INTO incomes (name, amount) VALUES (?, ?)", ["Main income", p.monthly_income]);
      if (p && p.goal_amount && g === 0) await q("INSERT INTO goals (name, amount) VALUES (?, ?)", [p.goal_name || "Savings goal", p.goal_amount]);
      await q("DROP TABLE profile");
    }
  } catch (err) {
    console.error("Could not set up incomes/goals tables:", err.message);
  }
}
setupProfileTables();

// Monthly budget per category, for "planned vs actual"
db.query(
  `CREATE TABLE IF NOT EXISTS budgets (
    category VARCHAR(100) PRIMARY KEY,
    amount DECIMAL(10,2) NOT NULL
  )`,
  (err) => {
    if (err) console.error("Could not create budgets table:", err.message);
  }
);

const CATEGORIES = ["Food & dining", "Transport", "Shopping", "Entertainment", "Other"];

function parseAmount(value) {
  return Number(value.replace(/\s/g, "").replace(",", "."));
}

function parseRBCTransactions(text) {
  const monthMap = {
    "janv": "01", "févr": "02", "mars": "03", "avr": "04",
    "mai": "05", "juin": "06", "juil": "07", "août": "08",
    "sept": "09", "oct": "10", "nov": "11", "déc": "12"
  };

  const yearMatch = text.match(/Du\s+\d+\s+\w+\s+(\d{4})/);
  const year = yearMatch ? yearMatch[1] : new Date().getFullYear();

  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const transactions = [];
  let currentDate = null;

  // Lines that signal a new block — don't consume as merchant continuation
  const isBlockStart = (l) =>
    /^\d{1,2}\s+[a-zéû]+\s/i.test(l) ||
    l.startsWith("Achat ") ||
    l.startsWith("Retrait ") ||
    l.startsWith("Virement ") ||
    l.startsWith("Dépôt ") ||
    l.startsWith("Solde ") ||
    l.startsWith("Télévirement ") ||
    l.startsWith("Intérêts ") ||
    l.startsWith("Contrepassation ") ||
    l.startsWith("Autorisation ") ||
    l.startsWith("Unité ") ||
    l.startsWith("Cpass ") ||
    l.startsWith("Renseignements ");

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Detect and strip leading date
    const dateMatch = line.match(/^(\d{1,2})\s+([a-zéû]+)\s+(.*)$/i);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, "0");
      const monthName = dateMatch[2].toLowerCase();
      const rest = dateMatch[3];
      if (monthMap[monthName]) {
        currentDate = `${year}-${monthMap[monthName]}-${day}`;
        line = rest;
      }
    }

    if (!currentDate) continue;

    const isExpense =
      line.startsWith("Achat Interac") ||
      line.startsWith("Achat Visa Débit") ||
      line.startsWith("Retrait GAB") ||
      line.startsWith("Virement envoyé") ||
      line.startsWith("Télévirement au compte de dépôt") ||
      line.startsWith("Intérêts sur découvert");

    if (!isExpense) continue;

    // For "Achat Interac" the merchant is on the NEXT line — combine it
    let combined = line;
    if (line.startsWith("Achat Interac") && i + 1 < lines.length && !isBlockStart(lines[i + 1])) {
      combined += " " + lines[i + 1];
      i++;
    }

    // Collect all numbers on the combined line (ignore negatives in parens)
    const moneyMatches = [...combined.matchAll(/\b(\d+),(\d{2})\b/g)];
    if (moneyMatches.length === 0) continue;

    // The transaction amount is the SMALLEST number — the balance is always larger
    const amounts = moneyMatches.map(m => ({
      value: parseAmount(m[0]),
      index: m.index,
      raw: m[0]
    }));

    const smallest = amounts.reduce((min, cur) => cur.value < min.value ? cur : min);

    // Skip if suspiciously large (balance leak) or zero
    if (smallest.value <= 0 || smallest.value > 5000) continue;

    // Build description: everything before the chosen amount
    let description = combined
      .substring(0, smallest.index)
      .replace(/^Achat Interac sans contact\s*-\s*\d+\s*/i, "")
      .replace(/^Achat Visa Débit\s*-\s*\d+\s*/i, "")
      .replace(/^Retrait GAB\s*-\s*\w+\s*/i, "ATM withdrawal")
      .replace(/^Virement envoyé\s+\S+\s*/i, "Transfer sent")
      .replace(/^Télévirement au compte de dépôt-\d+\s*/i, "Transfer to deposit account")
      .replace(/^Intérêts sur découvert\s*/i, "Overdraft interest")
      .trim();

    if (!description) description = "RBC transaction";

    transactions.push({
      date: currentDate,
      description,
      category: getCategory(description),
      amount: smallest.value
    });
  }

  return transactions;
}
app.get("/", (req, res) => {
  res.send("Backend is running");
});

app.get("/transactions", (req, res) => {
  const sql = `
    SELECT *
    FROM transactions
    ORDER BY date DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({
        error: err.message
      });
    }

    res.json(results);
  });
});

app.post("/transactions", (req, res) => {
  const { date, description, category, amount } = req.body;

  if (!date || !description || !category || !amount || amount <= 0) {
    return res.status(400).json({
      error: "Missing or invalid transaction data"
    });
  }

  const sql = `
    INSERT INTO transactions
    (date, description, category, amount)
    VALUES (?, ?, ?, ?)
  `;

  db.query(sql, [date, description, category, amount], (err, result) => {
    if (err) {
      return res.status(500).json({
        error: err.message
      });
    }

    res.json({
      id: result.insertId,
      date,
      description,
      category,
      amount
    });
  });
});

// Delete ALL transactions. Requires { "confirm": true } in the body,
// so it can't be triggered by accident with an empty request.
app.delete("/transactions", (req, res) => {
  if (!req.body || req.body.confirm !== true) {
    return res.status(400).json({ error: "Missing confirmation." });
  }

  db.query("DELETE FROM transactions", (err) => {
    if (err) {
      return res.status(500).json({
        error: err.message
      });
    }

    res.json({
      message: "All transactions deleted"
    });
  });
});

app.delete("/transactions/:id", (req, res) => {
  const id = req.params.id;

  const sql = `
    DELETE FROM transactions
    WHERE id = ?
  `;

  db.query(sql, [id], (err) => {
    if (err) {
      return res.status(500).json({
        error: err.message
      });
    }

    res.json({
      message: "Transaction deleted"
    });
  });
});

app.put("/transactions/:id", (req, res) => {
  const id = req.params.id;
  const { date, description, category, amount } = req.body;

  if (!date || !description || !category || !amount || amount <= 0) {
    return res.status(400).json({
      error: "Missing or invalid transaction data"
    });
  }

  const sql = `
    UPDATE transactions
    SET date = ?, description = ?, category = ?, amount = ?
    WHERE id = ?
  `;

  db.query(sql, [date, description, category, amount, id], (err) => {
    if (err) {
      return res.status(500).json({
        error: err.message
      });
    }

    res.json({
      id,
      date,
      description,
      category,
      amount
    });
  });
});

app.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    // Stop early if no file was sent
    if (!req.file) {
      return res.status(400).json({
        error: "No PDF uploaded."
      });
    }

    const fileBuffer = req.file.buffer; //file is in memory now
    const pdfData = await pdfParse(fileBuffer);

    // there is no file on disk to delete

    // 1. Try the fast rule-based RBC parser first
    let parsedTransactions = parseRBCTransactions(pdfData.text);
    let source = "rules";

    // 2. If it found nothing (other bank or other layout), let the AI read the PDF
    if (parsedTransactions.length === 0) {
      console.log("RBC parser found nothing, trying AI extraction...");
      parsedTransactions = (await extractTransactions(pdfData.text)).map(t => ({
        ...t,
        category: getCategory(t.description) // fallback category, AI may replace it
      }));
      source = "ai";
    }

    if (parsedTransactions.length === 0) {
      return res.status(400).json({
        error: "Could not find any transactions in this PDF."
      });
    }

    console.log(`Extracted ${parsedTransactions.length} transactions using ${source}`);

    // 3. AI categorization, rules stay as the fallback
    const aiCategories = await categorizeTransactions(parsedTransactions);

    let aiCount = 0;
    parsedTransactions.forEach((t, i) => {
      if (aiCategories[i]) {
        t.category = aiCategories[i];
        aiCount++;
      }
    });

    console.log(`AI categorized ${aiCount}/${parsedTransactions.length}, rules handled the rest`);

    const sql = `
      INSERT INTO transactions
      (date, description, category, amount)
      VALUES ?
    `;

    const values = parsedTransactions.map(t => [
      t.date,
      t.description,
      t.category,
      t.amount
    ]);

    db.query(sql, [values], (err, result) => {
      if (err) {
        return res.status(500).json({
          error: err.message
        });
      }

      res.json({
        message: "PDF imported successfully",
        imported: result.affectedRows
      });
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

// Monthly budgets per category ("planned" in planned vs actual)
app.get("/budgets", (req, res) => {
  db.query("SELECT category, amount FROM budgets", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const budgets = {};
    rows.forEach(r => { budgets[r.category] = Number(r.amount); });
    res.json(budgets);
  });
});

// Body: { "Food & dining": 300, "Transport": 100, ... }  (empty = no budget)
app.put("/budgets", async (req, res) => {
  const body = req.body || {};

  const rows = [];
  for (const category of CATEGORIES) {
    const value = body[category];
    if (value === "" || value == null) continue;
    const amount = Number(value);
    if (!(amount >= 0 && amount < 1000000)) {
      return res.status(400).json({ error: `Invalid budget for ${category}.` });
    }
    rows.push([category, Math.round(amount * 100) / 100]);
  }

  try {
    await db.promise().query("DELETE FROM budgets");
    if (rows.length) await db.promise().query("INSERT INTO budgets (category, amount) VALUES ?", [rows]);
    const budgets = {};
    rows.forEach(([c, a]) => { budgets[c] = a; });
    res.json(budgets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// My budget: a list of incomes and a list of savings goals (independent)
async function readProfile() {
  const [incomes] = await db.promise().query("SELECT name, amount FROM incomes ORDER BY id");
  const [goals] = await db.promise().query("SELECT name, amount FROM goals ORDER BY id");
  const clean = rows => rows.map(r => ({ name: r.name, amount: Number(r.amount) }));
  const inc = clean(incomes);
  return {
    incomes: inc,
    goals: clean(goals),
    totalMonthlyIncome: Math.round(inc.reduce((sum, i) => sum + i.amount, 0) * 100) / 100
  };
}

app.get("/profile", async (req, res) => {
  try {
    res.json(await readProfile());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Body: { incomes: [{ name, amount }], goals: [{ name, amount }] }
// Replaces both lists. Empty rows are ignored.
app.put("/profile", async (req, res) => {
  const body = req.body || {};

  function cleanList(list, label, max) {
    if (list == null) return [];
    if (!Array.isArray(list) || list.length > 20) throw new Error(`Invalid ${label} list.`);
    const out = [];
    for (const item of list) {
      const name = typeof item?.name === "string" ? item.name.trim().slice(0, 100) : "";
      const empty = item?.amount === "" || item?.amount == null;
      if (!name && empty) continue; // blank row
      const amount = Number(item.amount);
      if (empty || !(amount > 0 && amount < max)) throw new Error(`Each ${label} needs a positive amount.`);
      out.push([name || (label === "income" ? "Income" : "Savings goal"), Math.round(amount * 100) / 100]);
    }
    return out;
  }

  let incomes, goals;
  try {
    incomes = cleanList(body.incomes, "income", 1000000);
    goals = cleanList(body.goals, "goal", 10000000);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    await db.promise().query("DELETE FROM incomes");
    await db.promise().query("DELETE FROM goals");
    if (incomes.length) await db.promise().query("INSERT INTO incomes (name, amount) VALUES ?", [incomes]);
    if (goals.length) await db.promise().query("INSERT INTO goals (name, amount) VALUES ?", [goals]);
    res.json(await readProfile());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Budgeting strategies for the "Learn" section (same list the assistant searches)
app.get("/strategies", (req, res) => {
  res.json(STRATEGIES.map(({ keywords, ...s }) => s));
});

// Budget assistant chatbot (AI + function calling over the user's data)
app.post("/chat", async (req, res) => {
  const { messages } = req.body;

  // Validate input: a non-empty list of { role, text }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "No message sent." });
  }

  const history = messages
    .filter(m => m && typeof m.text === "string" && m.text.trim())
    .slice(-10) // only the last 10 messages, keeps cost low
    .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", text: m.text.slice(0, 2000) }));

  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return res.status(400).json({ error: "The last message must be from the user." });
  }

  try {
    const reply = await askChatbot(db, history);
    res.json({ reply });
  } catch (err) {
    console.error("Chatbot failed:", err.message);
    res.status(503).json({ error: "The assistant is unavailable right now. Please try again." });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});

module.exports = app;