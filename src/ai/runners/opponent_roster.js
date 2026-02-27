const DEFAULT_OPPONENT_ROSTER = Object.freeze([
    Object.freeze({ name: "local-old", url: "http://localhost:9000", type: "standard" }),
    Object.freeze({ name: "shapeshifter", url: "http://localhost:8080", type: "standard" }),
    Object.freeze({ name: "snek-two", url: "http://localhost:7000", type: "legacy" })
]);

function findRosterOpponent(name, roster = DEFAULT_OPPONENT_ROSTER) {
    const query = String(name || "").trim().toLowerCase();
    if (!query) return null;
    return roster.find(bot => bot.name.toLowerCase() === query) || null;
}

function isHttpUrl(value) {
    try {
        const parsed = new URL(String(value));
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_) {
        return false;
    }
}

function formatOpponentRoster(roster = DEFAULT_OPPONENT_ROSTER) {
    const entries = Array.isArray(roster) ? roster : [];
    const nameWidth = Math.max("Name".length, ...entries.map(bot => String(bot.name || "").length));
    const typeWidth = Math.max("API".length, ...entries.map(bot => String(bot.type || "").length));
    const pad = (value, width) => String(value || "").padEnd(width, " ");

    const lines = [
        "Available opponents:",
        `${pad("Name", nameWidth)}  ${pad("API", typeWidth)}  URL`,
        `${"-".repeat(nameWidth)}  ${"-".repeat(typeWidth)}  ${"-".repeat(40)}`
    ];

    for (const bot of entries) {
        lines.push(`${pad(bot.name, nameWidth)}  ${pad(bot.type, typeWidth)}  ${bot.url}`);
    }
    return lines.join("\n");
}

module.exports = {
    DEFAULT_OPPONENT_ROSTER,
    findRosterOpponent,
    isHttpUrl,
    formatOpponentRoster
};
