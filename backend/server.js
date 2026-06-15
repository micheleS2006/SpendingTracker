const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const fs = require("fs");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

db.connect((err) => {
  if (err) {
    console.error("Database connection failed:", err);
    return;
  }

  console.log("Connected to MySQL");
});

function parseAmount(value) {
  return Number(value.replace(/\s/g, "").replace(",", "."));
}

function getCategory(desc) {
  const d = desc.toLowerCase();

  if (
    d.includes("tim hortons") ||
    d.includes("mcdonald") ||
    d.includes("kfc") ||
    d.includes("subway") ||
    d.includes("starbucks") ||
    d.includes("sushi") ||
    d.includes("burger") ||
    d.includes("pizza") ||
    d.includes("pretzel") ||
    d.includes("tiger sugar") ||
    d.includes("poulet rouge") ||
    d.includes("jugo juice") ||
    d.includes("van houtte") ||
    d.includes("3 brasseurs")
  ) {
    return "Food & dining";
  }

  if (
    d.includes("uber") ||
    d.includes("chrono") ||
    d.includes("rem station")
  ) {
    return "Transport";
  }

  if (
    d.includes("amazon") ||
    d.includes("dollarama") ||
    d.includes("miniso") ||
    d.includes("etsy") ||
    d.includes("jean coutu") ||
    d.includes("magasins")
  ) {
    return "Shopping";
  }

  if (
    d.includes("netflix") ||
    d.includes("spotify") ||
    d.includes("ceramic cafe")
  ) {
    return "Entertainment";
  }

  return "Other";
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

app.delete("/transactions", (req, res) => {
  const sql = "DELETE FROM transactions";

  db.query(sql, (err) => {
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
    const fileBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(fileBuffer);

    fs.unlinkSync(req.file.path);

    const parsedTransactions = parseRBCTransactions(pdfData.text);

    if (parsedTransactions.length === 0) {
      return res.status(400).json({
        error: "No RBC transactions found in this PDF."
      });
    }

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

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});