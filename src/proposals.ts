import { request, gql } from 'graphql-request'
import fs from 'fs';
import { formatUnits } from 'viem';

const main = async () => {
    try {
        const query = gql`{
            votes(first: 1000 orderBy: startDate, orderDirection: desc) {
                voteNum
                creator
                metadata
                executed
                startDate
                supportRequiredPct
                minAcceptQuorum
                yea
                nay
                votingPower
                castCount
              }
            }`;

        const data = (await request("https://api.thegraph.com/subgraphs/name/curvefi/curvevoting4", query)) as any;

        const votes = data.votes.map((v: any, index: number) => {
            let metadata = v.metadata;
            if (metadata) {
                try {
                    metadata = JSON.parse(v.metadata).text;
                }
                catch (e) { }
            }

            const nay = parseFloat(formatUnits(v.nay, 18));
            const yea = parseFloat(formatUnits(v.yea, 18));

            const total = nay + yea;

            let yeaPercentage = 0;
            let nayPercentage = 0;
            if (total > 0) {
                yeaPercentage = yea * 100 / total;
                nayPercentage = nay * 100 / total;
            }

            const minAcceptQuorum = parseFloat(formatUnits(v.minAcceptQuorum, 18));
            const supportRequiredPct = parseFloat(formatUnits(v.supportRequiredPct, 18));

            const haveSupport = yeaPercentage >= supportRequiredPct * 100;

            const votingPower = parseFloat(formatUnits(v.votingPower, 18));
            const haveQuorum = total * 100 / votingPower > minAcceptQuorum * 100;

            return {
                ...v,
                id: index,
                metadata,
                yea: parseFloat(yeaPercentage.toFixed(2)),
                nay: parseFloat(nayPercentage.toFixed(2)),
                haveSupport,
                haveQuorum,
                minAcceptQuorum: parseFloat(minAcceptQuorum.toFixed(2)),
                supportRequiredPct: parseFloat(supportRequiredPct.toFixed(2)),
                votingPower
            };
        });
        fs.writeFileSync("./data/proposals.json", JSON.stringify(votes));
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