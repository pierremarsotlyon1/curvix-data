const fs = require("fs");

const files = fs.readdirSync("./data/gauges");

for(const file of files) {
    const data = JSON.parse(fs.readFileSync("./data/gauges/"+file));

    for(const key of Object.keys(data)) {
        data[key].lpTotalSupplys = [];
        data[key].gaugeTotalSupplys = [];
    }

    fs.writeFileSync("./data/gauges/"+file, JSON.stringify(data));
}