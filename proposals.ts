import { request, gql } from 'graphql-request'
import fs from 'fs';

const main = async () => {
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

        const nay = BigInt(v.nay) / (10n ** 14n);
        const yea = BigInt(v.yea) / (10n ** 14n);

        const total = nay + yea;

        let yeaPercentage = 0;
        let nayPercentage = 0;
        if (total > 0) {
            yeaPercentage = Number(yea) * 100 / Number(total);
            nayPercentage = Number(nay) * 100 / Number(total);
        }


        return {
            ...v,
            id: index,
            metadata,
            yea: parseFloat(yeaPercentage.toFixed(2)),
            nay: parseFloat(nayPercentage.toFixed(2)),
        };
    });
    fs.writeFileSync("./data/proposals.json", JSON.stringify(votes));
}


// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});