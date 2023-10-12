import fs from 'fs';
import { createPublicClient, formatUnits, http, parseAbi, parseUnits } from 'viem';
import axios from "axios";
import { mainnet } from 'viem/chains';
import { RPC_URL, WEEK } from './utils/rpc';
import { CRV_ADDRESS, CURVE_GAUGE_CONTROLLER } from './utils/addresses';
import _ from 'underscore';
import { getTokenData } from './utils/defilamma';

const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(RPC_URL),
    batch: {
        multicall: true
    }
});

const abi = parseAbi([
    'function get_gauge_weight(address gauge) view returns (uint256)',
    'function get_total_weight() view returns (uint256)',
]);

const getEndpoints = async (): Promise<string[]> => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const { data: readme } = await axios.get("https://raw.githubusercontent.com/curvefi/curve-api/11a52585949bb473b55b557527aecbf016723306/endpoints.md");
    return readme.match(urlRegex).filter((url: string) => url.indexOf("/getPools/") > -1);
}

interface IToken {
    address: string;
    decimals: string;
    usdPrice: number;
    symbol: string;
    poolBalance: string;
}

interface IPoolToken {
    id: number;
    address: string;
    decimals: number;
    usdPrice: number;
    symbol: string;
    poolBalance: string;
}

interface IGauge {
    gauge: string;
    side_chain: boolean;
    gauge_data: {
        working_supply: string;
    };
    gauge_controller: {
        gauge_relative_weight: string;
        get_gauge_weight: string;
        inflation_rate: string;
    };
    is_killed: boolean;
    lpTokenPrice: number;
    hasNoCrv: boolean;
}

interface IPool {
    name: string;
    address: string;
    gaugeAddress: string;
    lpTokenAddress: string;
    coins: IToken[];
    usdTotal: number;
    gaugeCrvApy: number[];
    virtualPrice: string;
}

type PoolDataMap = { 
    [gaugeAddress: string]: IPool; 
}

interface PoolData {
    id: number;
    name: string;
    address: string;
    gaugeAddress: string;
    lpTokenAddress: string;
    tokens: IPoolToken[];
    usdTotal: number;
    gaugeCrvApy: number[];
    futureGaugeCrvApy: number[];
    side_chain: boolean;
    working_supply: string;
    gauge_relative_weight: string;
    get_gauge_weight: string;
    inflation_rate: string;
    is_killed: boolean;
    hasNoCrv: boolean;
    lpTokenPrice: number;
    virtualPrice: number;
}

const main = async () => {
    try {

        const crvData = await getTokenData(CRV_ADDRESS);

        const currentBlock = await publicClient.getBlock();
        const currentPeriod = Math.floor(Number(currentBlock.timestamp) / WEEK) * WEEK;

        const endpoints = await getEndpoints();

        const endpointResponses = await Promise.all(endpoints.map((endpoint: string) => axios.get(endpoint)));
        const endpointDatas = endpointResponses.reduce((acc: PoolDataMap, endpointResponse: any) => {
            for (const pool of endpointResponse.data.data.poolData) {
                if(!pool.gaugeAddress) {
                    continue;
                }
                acc[pool.gaugeAddress.toLowerCase()] = pool;
            }
            return acc;
        }, {});

        const allGaugesResp = await axios.get("https://api.curve.fi/api/getAllGauges");
        const gauges: IGauge[] = Object.values(allGaugesResp.data.data);

        const calls: any[] = [
            {
                address: CURVE_GAUGE_CONTROLLER,
                abi,
                functionName: 'get_total_weight',
            }
        ];

        // We have them on the Curve API but it's to be sure to be sync with the blockchain
        for (const gauge of gauges) {
            const pool = endpointDatas[gauge.gauge.toLowerCase()];
            if (!pool) {
                continue;
            }

            calls.push({
                address: CURVE_GAUGE_CONTROLLER,
                abi,
                functionName: 'get_gauge_weight',
                args: [gauge.gauge]
            });
        }

        const chunks = _.chunk(calls, 50);

        let responses: any[] = [];
        for (const chunk of chunks) {
            const results = await publicClient.multicall({
                contracts: chunk
            });
            responses = responses.concat(results);
        }

        // Get current data (APYs range, TVL ...)
        const pools: PoolData[] = [];

        const totalWeight = responses.shift().result;

        for (let i = 0; i < gauges.length; i++) {
            const gauge = gauges[i];
            const pool = endpointDatas[gauge.gauge.toLowerCase()];
            if (!pool) {
                //console.log("Gauge not found " + gauge.gauge);
                continue;
            }

            const name = pool.coins.map((token) => token.symbol).join("/");
            const futurWeight = responses.shift().result;

            const newWeight = BigInt(futurWeight) * 100n / (BigInt(totalWeight) / 10n ** 18n / 10n ** 18n);

            if (typeof gauge.gauge_controller.inflation_rate === 'number') {
                gauge.gauge_controller.inflation_rate = Math.floor(gauge.gauge_controller.inflation_rate).toString();
            }

            const inflation = formatUnits(BigInt(gauge.gauge_controller.inflation_rate), 18);
            
            const virtualprice = formatUnits(BigInt(pool.virtualPrice), 18);
            const workingsupply = formatUnits(BigInt(gauge.gauge_data.working_supply), 18);

            let newMaxApy = (crvData.price * parseFloat(inflation) * parseFloat(formatUnits(newWeight, 18)) * 31536000) / (parseFloat(workingsupply) * crvData.price * parseFloat(virtualprice));
            let newMinApy = newMaxApy * 0.4;

            if (gauge.hasNoCrv || gauge.is_killed) {
                pool.gaugeCrvApy = [0, 0];
                newMaxApy = 0;
                newMinApy = 0;
            }

            if (!pool.gaugeCrvApy || pool.gaugeCrvApy[0] === null) {
                pool.gaugeCrvApy = [0, 0];
            }

            const poolData: PoolData = {
                id: i,
                name,
                address: pool.address,
                gaugeAddress: pool.gaugeAddress,
                lpTokenAddress: pool.lpTokenAddress,
                tokens: pool.coins.map((coin, index) => {
                    return {
                        id: index,
                        address: coin.address,
                        decimals: parseInt(coin.decimals),
                        symbol: coin.symbol,
                        usdPrice: coin.usdPrice || 0,
                        poolBalance: coin.poolBalance || "",
                    }
                }),
                usdTotal: pool.usdTotal,
                gaugeCrvApy: pool.gaugeCrvApy,
                futureGaugeCrvApy: [newMinApy, newMaxApy],
                side_chain: gauge.side_chain,
                working_supply: gauge.gauge_data.working_supply,
                gauge_relative_weight: gauge.gauge_controller.gauge_relative_weight,
                get_gauge_weight: futurWeight.toString(),
                inflation_rate: gauge.gauge_controller.inflation_rate,
                is_killed: gauge.is_killed,
                hasNoCrv: gauge.hasNoCrv,
                lpTokenPrice: gauge.lpTokenPrice || 0,
                virtualPrice: Number(parseUnits(pool.virtualPrice.toString(), 18))
            };

            const path = `./data/gauges/${pool.gaugeAddress.toLowerCase()}.json`;
            let initData: any = {};
            if (fs.existsSync(path)) {
                initData = JSON.parse(fs.readFileSync(path, "utf-8"));
            }

            const newPercentage = parseFloat(formatUnits(newWeight, 18));
            initData[currentPeriod] = {
                newWeight: futurWeight.toString(),
                newPercentage,
                gaugeCrvApy: pool.gaugeCrvApy,
                futureGaugeCrvApy: [newMinApy, newMaxApy],
                inflation_rate: gauge.gauge_controller.inflation_rate,
            };
            fs.writeFileSync(path, JSON.stringify(initData));

            pools.push(poolData);
        }

        fs.writeFileSync("./data/pools.json", JSON.stringify(pools));
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