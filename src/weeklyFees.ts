import fs from 'fs';
import axios from "axios";

const main = async () => {

    try {
        const data = await axios.get("https://api.curve.fi/api/getWeeklyFees");
        fs.writeFileSync("./data/weeklyFees.json", JSON.stringify(data.data.data.weeklyFeesTable));
    }
    catch (e) {
        console.error(e);
    }
}


// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});