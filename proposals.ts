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
    fs.writeFileSync("./data/proposals.json", JSON.stringify(data.votes));
}


// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});