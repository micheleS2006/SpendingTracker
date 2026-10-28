// Rule-based categorizer (the original approach, kept as the fallback)
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

module.exports = { getCategory };