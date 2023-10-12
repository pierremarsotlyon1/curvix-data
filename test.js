const r = require("./data/pools.json");

console.log(r.filter((m) => m.latestWeeklyApy === null || m.latestWeeklyApy === undefined))