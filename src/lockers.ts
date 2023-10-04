import { createPublicClient, formatUnits, http, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'
import { VE_CRV } from './constants';
import fs from "fs";

const publicClient = createPublicClient({
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
});

const abi = parseAbi([
    'function balanceOf(address owner) view returns (uint256)',
    'function locked(address owner) view returns (int128,uint256)',
]);

const lockers = [
    {
        name: "Stake DAO",
        address: "0x52f541764E6e90eeBc5c21Ff570De0e2D63766B6",
    },
    {
        name: "Convex",
        address: "0x989AEb4d175e16225E39E87d0D97A3360524AD80",
    },
    {
        name: "Yearn",
        address: "0xF147b8125d2ef93FB6965Db97D6746952a133934",
    },
];


const main = async () => {
    try {
        let calls: any[] = [];

        for (const locker of lockers) {
            calls.push({
                address: VE_CRV,
                abi,
                functionName: 'balanceOf',
                args: [locker.address]
            });
            calls.push({
                address: VE_CRV,
                abi,
                functionName: 'locked',
                args: [locker.address]
            });
        }

        const results: any[] = await publicClient.multicall({ contracts: calls });

        const lockersData: any[] = [];
        for (const locker of lockers) {
            const veBalance = formatUnits(results.shift().result, 18);
            const crvLockedBalance = formatUnits(results.shift().result[0], 18);

            lockersData.push({
                name: locker.name,
                veBalance: parseFloat(veBalance),
                crvLockedBalance: parseFloat(crvLockedBalance),
            });
        }

        fs.writeFileSync("./data/lockers.json", JSON.stringify(lockersData));
    }
    catch (e) {
        console.error(e);
    }
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});