const { searchStrategies, STRATEGIES } = require("./strategies");

// The ONLY things the chatbot is allowed to do with the database.
// Each tool runs a predefined, parameterized SQL query. The AI picks
// a tool and its arguments; it never writes SQL itself.

const MONTH_RE = /^\d{4}-\d{2}$/; // "2026-09"

// Builds "WHERE ..." for an optional month filter
function monthFilter(month) {
  if (month && MONTH_RE.test(month)) {
    return { where: "WHERE DATE_FORMAT(date, '%Y-%m') = ?", params: [month] };
  }
  return { where: "", params: [] };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function createTools(db) {
  const q = (sql, params = []) => db.promise().query(sql, params).then(([rows]) => rows);

  async function loadProfile() {
    const incomes = (await q("SELECT name, amount FROM incomes ORDER BY id"))
      .map(r => ({ name: r.name, monthlyAmount: round2(r.amount) }));
    const goals = (await q("SELECT name, amount FROM goals ORDER BY id"))
      .map(r => ({ name: r.name, target: round2(r.amount) }));
    return {
      incomes,
      totalMonthlyIncome: round2(incomes.reduce((s, i) => s + i.monthlyAmount, 0)),
      goals,
    };
  }

  return {
    // The user's saved incomes and savings goals
    async getProfile() {
      return loadProfile();
    },

    // Search the budgeting strategies knowledge base (retrieval)
    async searchStrategies({ query } = {}) {
      const found = searchStrategies(query, 3);
      if (found.length === 0) {
        return { message: "No matching strategy.", available: STRATEGIES.map(s => s.name) };
      }
      return found.map(({ keywords, ...s }) => s);
    },

    // Total spent per category (optionally for one month)
    async getSpendingByCategory({ month } = {}) {
      const f = monthFilter(month);
      const rows = await q(
        `SELECT category, SUM(amount) AS total, COUNT(*) AS count
         FROM transactions ${f.where}
         GROUP BY category ORDER BY total DESC`,
        f.params
      );
      return {
        month: f.params[0] || "all time",
        categories: rows.map(r => ({ category: r.category, total: round2(r.total), count: r.count })),
      };
    },

    // Planned (monthly budget) vs actual spending per category
    async getBudgetVsActual({ month } = {}) {
      const f = monthFilter(month);
      const budgets = await q("SELECT category, amount FROM budgets");
      if (budgets.length === 0) return { error: "No category budgets saved yet. The user can set them on the Categories page." };

      const actual = await q(
        `SELECT category, SUM(amount) AS total FROM transactions ${f.where} GROUP BY category`,
        f.params
      );
      const months = f.params.length ? 1 : Math.max(
        (await q("SELECT COUNT(DISTINCT DATE_FORMAT(date, '%Y-%m')) AS n FROM transactions"))[0].n, 1);

      return {
        period: f.params[0] || `all time (${months} month(s), budgets multiplied by ${months})`,
        categories: budgets.map(b => {
          const planned = round2(Number(b.amount) * months);
          const spent = round2((actual.find(a => a.category === b.category) || {}).total || 0);
          return { category: b.category, planned, spent, difference: round2(planned - spent), overBudget: spent > planned };
        }),
      };
    },

    // Biggest individual merchants (optionally for one month / one category)
    async getTopMerchants({ month, category, limit } = {}) {
      const f = monthFilter(month);
      const params = [...f.params];
      let where = f.where;
      if (category) {
        where += where ? " AND category = ?" : "WHERE category = ?";
        params.push(category);
      }
      const n = Math.min(Math.max(parseInt(limit) || 5, 1), 20);
      params.push(n);
      const rows = await q(
        `SELECT description, SUM(amount) AS total, COUNT(*) AS count
         FROM transactions ${where}
         GROUP BY description ORDER BY total DESC LIMIT ?`,
        params
      );
      return rows.map(r => ({ merchant: r.description, total: round2(r.total), count: r.count }));
    },

    // Total spent each month, to see trends
    async getMonthlyTotals() {
      const rows = await q(
        `SELECT DATE_FORMAT(date, '%Y-%m') AS month, SUM(amount) AS total, COUNT(*) AS count
         FROM transactions GROUP BY month ORDER BY month`
      );
      return rows.map(r => ({ month: r.month, total: round2(r.total), count: r.count }));
    },

    // Savings projection. The MATH happens here in code, not in the AI.
    async predictSavings({ monthlyIncome, months, reduceCategory, reducePercent } = {}) {
      const profile = await loadProfile();

      // Income from the question if given, otherwise the total of all saved incomes
      const income = Number(monthlyIncome) || Number(profile.totalMonthlyIncome);
      if (!income || income <= 0) {
        return { error: "No income saved. Ask the user for it, or suggest adding it in My budget." };
      }
      const horizon = Math.min(Math.max(parseInt(months) || 6, 1), 60);

      // Average monthly spending over the last 3 months that have data
      const monthly = await q(
        `SELECT DATE_FORMAT(date, '%Y-%m') AS month, SUM(amount) AS total
         FROM transactions GROUP BY month ORDER BY month DESC LIMIT 3`
      );
      if (monthly.length === 0) return { error: "No transactions yet." };
      const avgSpending = monthly.reduce((s, r) => s + Number(r.total), 0) / monthly.length;

      // Optional what-if: reduce one category by a percentage
      let reduction = 0;
      if (reduceCategory && reducePercent) {
        const pct = Math.min(Math.max(Number(reducePercent), 0), 100);
        const months3 = monthly.map(r => r.month);
        const rows = await q(
          `SELECT SUM(amount) AS total FROM transactions
           WHERE category = ? AND DATE_FORMAT(date, '%Y-%m') IN (?)`,
          [reduceCategory, months3]
        );
        const avgCategory = Number(rows[0].total || 0) / monthly.length;
        reduction = avgCategory * (pct / 100);
      }

      const monthlySavings = income - avgSpending + reduction;

      // Each goal on its own: months to reach it if ALL monthly savings went to it.
      // Calculated here, never by the AI.
      const goals = profile.goals.map(g => ({
        name: g.name,
        target: g.target,
        monthsIfAllSavingsGoHere: monthlySavings > 0 ? Math.ceil(g.target / monthlySavings) : null,
      }));
      const totalGoals = round2(profile.goals.reduce((s, g) => s + g.target, 0));

      return {
        incomeSource: Number(monthlyIncome) ? "from the question" : "total of saved incomes",
        goals,
        allGoals: goals.length > 1
          ? { totalTarget: totalGoals, monthsToReachAll: monthlySavings > 0 ? Math.ceil(totalGoals / monthlySavings) : null }
          : undefined,
        basedOnMonths: monthly.map(r => r.month).reverse(),
        monthlyIncome: round2(income),
        averageMonthlySpending: round2(avgSpending),
        monthlyCutFromWhatIf: round2(reduction),
        projectedMonthlySavings: round2(monthlySavings),
        months: horizon,
        projectedTotalSavings: round2(monthlySavings * horizon),
      };
    },
  };
}

module.exports = { createTools };