import { createPublicClient, formatEther, formatUnits, http, parseAbi, parseEther } from 'viem'
import { mainnet } from 'viem/chains'
import { VE_CRV } from './constants';
import fs from "fs";
import dotenv from "dotenv";
import { getTokenData } from './utils/defilamma';
import axios from "axios";

dotenv.config();

const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(`https://eth.llamarpc.com`), // http(`https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`),
    batch: {
        multicall: true
    }
});

const abi = parseAbi([
    'function balanceOf(address owner) view returns (uint256)',
    'function locked(address owner) view returns (int128,uint256)',
    'function strategy() view returns (address)',
    'function gauge() view returns (address)',
    'function totalSupply() view returns (uint256)',
    'function reward_count() view returns (uint256)',
    'function reward_tokens(uint256 i) view returns (address)',
    'function reward_data(address token) view returns (address,address,uint256,uint256,uint256,uint256)',
    'function mainRewardRates() view returns (address[],uint256[],uint256[])',
    'function apr(uint256 rate, uint256 price, uint256 price) view returns (uint256)',
]);

const STAKEDAO_LOCKER = "0x52f541764E6e90eeBc5c21Ff570De0e2D63766B6";
const CONVEX_LOCKER = "0x989AEb4d175e16225E39E87d0D97A3360524AD80";
const CONVEX_UTILS_CONTRACT = "0xadd2F542f9FF06405Fabf8CaE4A74bD0FE29c673";
const YEARN_LOCKER = "0xF147b8125d2ef93FB6965Db97D6746952a133934";
const CRV_ADDRESS = "0xD533a949740bb3306d119CC777fa900bA034cd52";

const lockers = [
    {
        name: "Stake DAO",
        address: STAKEDAO_LOCKER,
    },
    {
        name: "Convex",
        address: CONVEX_LOCKER,
    },
    {
        name: "Yearn",
        address: YEARN_LOCKER,
    },
];

const lockersLock = async () => {
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

const stakeDAOYield = async () => {
    // Stake DAO locker
    let results: any[] = await publicClient.multicall({
        contracts: [
            {
                address: STAKEDAO_LOCKER,
                abi,
                functionName: 'strategy',
            }
        ]
    });
    const strategy = results.shift().result;

    results = await publicClient.multicall({
        contracts: [
            {
                address: strategy,
                abi,
                functionName: 'gauge',
            }
        ]
    });
    const gauge = results.shift().result;

    results = await publicClient.multicall({
        contracts: [
            {
                address: gauge,
                abi,
                functionName: 'reward_count',
            },
            {
                address: gauge,
                abi,
                functionName: 'totalSupply',
            }
        ]
    });
    const reward_count = results.shift().result;
    const totalSupply = results.shift().result;

    let calls: any[] = [];
    for (let i = 0; i < Number(reward_count); i++) {
        calls.push({
            address: gauge,
            abi,
            functionName: 'reward_tokens',
            args: [i]
        });
    }

    results = await publicClient.multicall({ contracts: calls });

    const tokenRewardAddresses: string[] = [];
    calls = [];
    for (let i = 0; i < Number(reward_count); i++) {
        const tokenRewardAddress = results.shift().result;
        tokenRewardAddresses.push(tokenRewardAddress);

        calls.push({
            address: gauge,
            abi,
            functionName: 'reward_data',
            args: [tokenRewardAddress]
        });
    }

    results = await publicClient.multicall({ contracts: calls });

    const crvData = await getTokenData(CRV_ADDRESS);

    let totalApr = 0;
    for (const tokenRewardAddress of tokenRewardAddresses) {
        const tokenData = await getTokenData(tokenRewardAddress);

        const rewardData: any = results.shift().result;
        const rate = rewardData[3];

        const rewardPerYearUSD = parseEther(tokenData.price.toString())
            * rate
            * 31536000n
            * 10n ** 18n
            / 10n ** BigInt(tokenData.decimals);

        const valueStakedUSD = parseEther(crvData.price.toString()) * totalSupply * 10n ** 18n / 10n ** BigInt(18);

        const tokenApr = parseFloat(formatEther(rewardPerYearUSD * 10n ** 18n / valueStakedUSD)) * 100;
        totalApr += tokenApr;
    }

    const { data: delegationsAPRs } = await axios.get("https://raw.githubusercontent.com/StakeDAO/bribes/main/delegationsAPRs.json");
    const bountiesApr = delegationsAPRs["sdcrv.eth"];
    totalApr += bountiesApr;

    return totalApr;
};

const convexYield = async () => {
    let results: any[] = await publicClient.multicall({
        contracts: [
            {
                address: CONVEX_UTILS_CONTRACT,
                abi,
                functionName: 'mainRewardRates',
            }
        ]
    });
    const mainRewardRates = results.shift().result;

    const tokenRewardAddresses = mainRewardRates[0];
    const rates = mainRewardRates[1];

    let totalApr = 0;
    for (let i = 0; i < tokenRewardAddresses.length; i++) {
        const tokenRewardAddress = tokenRewardAddresses[i];
        const tokenData = await getTokenData(tokenRewardAddress);

        const rate = rates[i];
        results = await publicClient.multicall({
            contracts: [
                {
                    address: CONVEX_UTILS_CONTRACT,
                    abi,
                    functionName: 'apr',
                    args: [rate, BigInt(tokenData.price * 10 ** 18), BigInt(tokenData.price * 10 ** 18)]
                }
            ]
        });

        const apr = parseFloat(formatUnits(results.shift().result, 18)) * 100;
        totalApr += apr;
    }

    return totalApr;

};

const yearnYield = async (): Promise<number> => {
    const data = await axios.get("https://yields.llama.fi/poolsEnriched?pool=320550a3-b7c4-4017-a5dd-f3ebed459470");
    return data.data.data[0].apy;
}

const lockersYield = async () => {
    try {
        const stakeDAOApr = await stakeDAOYield();
        const convexApr = await convexYield();
        const yearnApr = await yearnYield();

        fs.writeFileSync("./data/lockers-yield.json", JSON.stringify({
            stakedao: stakeDAOApr,
            convex: convexApr,
            yearn: yearnApr
        }));
    }
    catch(e) {
        console.log(e);
    }
};


const main = async () => {
    await lockersLock();
    await lockersYield();
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});