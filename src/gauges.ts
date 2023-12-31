import fs from 'fs';
import { formatUnits, parseAbi, parseUnits } from 'viem';
import axios from "axios";
import { WEEK, getRpcClient } from './utils/rpc';
import { CRV_ADDRESS, CURVE_GAUGE_CONTROLLER } from './utils/addresses';
import _ from 'underscore';
import { getTokenData } from './utils/defilamma';
import dotenv from "dotenv";

dotenv.config();

const abi = parseAbi([
    'function get_gauge_weight(address gauge) view returns (uint256)',
    'function get_total_weight() view returns (uint256)',
    'function totalSupply() view returns (uint256)',
]);

const getEndpoints = async (): Promise<string[]> => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const { data: readme } = await axios.get("https://raw.githubusercontent.com/curvefi/curve-api/11a52585949bb473b55b557527aecbf016723306/endpoints.md");
    return readme.match(urlRegex).filter((url: string) => url.indexOf("/getPools/") > -1);
}

const EMPTY_TOKEN_IMAGE_URL = "https://etherscan.io/images/main/empty-token.png";

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
    imageUrl: string;
}

interface IGauge {
    gauge: string;
    swap: string;
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

interface IBaseApy {
    address: string;
    latestDailyApy: number;
    latestWeeklyApy: number;
}

type BaseApyMap = {
    [gaugeAddress: string]: IBaseApy;
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
    latestWeeklyApy: number;
}

interface HistoricalPoolData {
    newWeight: string;
    newPercentage: number;
    gaugeCrvApy: number[];
    futureGaugeCrvApy: number[];
    inflation_rate: string;
    lpTotalSupplys: HistoricalTotalSupply[];
    gaugeTotalSupplys: HistoricalTotalSupply[];
}

interface HistoricalTotalSupply {
    timestamp: number;
    totalSupply: string;
}

const main = async () => {
    try {

        const publicClient = await getRpcClient();
        if (!publicClient) {
            console.log("No RPC found");
            return;
        }

        const currentBlock = await publicClient.getBlock();
        const blockTimestamp = Number(currentBlock.timestamp);
        const currentPeriod = Math.floor(blockTimestamp / WEEK) * WEEK;

        // CRV data
        const crvData = await getTokenData(CRV_ADDRESS);

        // Endpoints for pools data
        const endpoints = await getEndpoints();

        // Get all chain names
        const chains = endpoints.map((endpoint: string) => {
            const split = endpoint.split("/");
            return split[split.length - 2];
        });

        // Endpoint for base apys data
        const endpointsBaseApys = chains.map((chain: string) => `https://api.curve.fi/api/getSubgraphData/${chain}`);

        const endpointResponses = await Promise.all(endpoints.map((endpoint: string) => axios.get(endpoint)));
        const endpointDatas = endpointResponses.reduce((acc: PoolDataMap, endpointResponse: any) => {
            for (const pool of endpointResponse.data.data.poolData) {
                if (!pool.gaugeAddress) {
                    continue;
                }
                acc[pool.gaugeAddress.toLowerCase()] = pool;
            }
            return acc;
        }, {});

        const endpointsBaseApysResponses = await Promise.all(endpointsBaseApys.map((endpoint: string) => axios.get(endpoint)));
        const endpointBaseApysDatas = endpointsBaseApysResponses.reduce((acc: BaseApyMap, endpointResponse: any) => {
            for (const pool of endpointResponse.data.data.poolList) {
                if (!pool.address) {
                    continue;
                }
                acc[pool.address.toLowerCase()] = pool;
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
            calls.push({
                address: pool.lpTokenAddress,
                abi,
                functionName: 'totalSupply'
            });

            calls.push({
                address: pool.gaugeAddress,
                abi,
                functionName: 'totalSupply',
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

        const mapTokenUrls: any = {};

        for (let i = 0; i < gauges.length; i++) {
            const gauge = gauges[i];
            const pool = endpointDatas[gauge.gauge.toLowerCase()];
            if (!pool) {
                //console.log("Gauge not found " + gauge.gauge);
                continue;
            }

            const name = pool.coins.map((token) => token.symbol).join("/");
            const futurWeight = responses.shift().result;
            const lpTotalSupplyResp = responses.shift();
            const lpTotalSupply = lpTotalSupplyResp.status === "failure" ? BigInt(0) : BigInt(lpTotalSupplyResp.result);
            const gaugeTotalSupplyResp = responses.shift();
            const gaugeTotalSupply = gaugeTotalSupplyResp.status === "failure" ? BigInt(0) : BigInt(gaugeTotalSupplyResp.result);

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

            if (!isFinite(newMinApy) || !isFinite(newMaxApy)) {
                newMaxApy = 0;
                newMinApy = 0;
            }

            const baseApyData: IBaseApy = endpointBaseApysDatas[gauge.swap.toLowerCase()];
            let latestWeeklyApy = 0;
            if (baseApyData) {
                latestWeeklyApy = baseApyData.latestWeeklyApy;
            }

            const poolTokens: IPoolToken[] = [];
            for (let a = 0; a < pool.coins.length; a++) {
                const coin = pool.coins[a]
                const baseImageUrl = `https://cdn.jsdelivr.net/gh/curvefi/curve-assets/images/assets/${coin.address.toLowerCase()}.png`;
                let imageUrl = mapTokenUrls[baseImageUrl];

                if (!imageUrl) {
                    try {
                        const resp = await axios.get(baseImageUrl);
                        if (resp.status !== 200) {
                            imageUrl = EMPTY_TOKEN_IMAGE_URL;
                        } else {
                            imageUrl = baseImageUrl;
                        }
                    }
                    catch (e) {
                        imageUrl = EMPTY_TOKEN_IMAGE_URL;
                    }

                    mapTokenUrls[baseImageUrl] = imageUrl;
                }

                poolTokens.push({
                    id: a,
                    address: coin.address,
                    decimals: parseInt(coin.decimals),
                    symbol: coin.symbol,
                    usdPrice: coin.usdPrice || 0,
                    poolBalance: coin.poolBalance || "",
                    imageUrl
                })
            }

            const poolData: PoolData = {
                id: i,
                name,
                address: pool.address,
                gaugeAddress: pool.gaugeAddress,
                lpTokenAddress: pool.lpTokenAddress,
                tokens: poolTokens,
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
                virtualPrice: Number(parseUnits(pool.virtualPrice.toString(), 18)),
                latestWeeklyApy
            };

            const path = `./data/gauges/${pool.gaugeAddress.toLowerCase()}.json`;
            let initData: any = {};

            if (fs.existsSync(path)) {
                initData = JSON.parse(fs.readFileSync(path, "utf-8"));
            }

            let historicalData = initData[currentPeriod] as HistoricalPoolData;
            if (!historicalData) {
                historicalData = {
                    futureGaugeCrvApy: [],
                    gaugeCrvApy: [],
                    gaugeTotalSupplys: [],
                    inflation_rate: "",
                    lpTotalSupplys: [],
                    newPercentage: 0,
                    newWeight: "",
                };
            }

            const newHistoricalLpTotalSupply: HistoricalTotalSupply = {
                timestamp: blockTimestamp,
                totalSupply: lpTotalSupply.toString()
            };

            if (historicalData.lpTotalSupplys.length > 0) {
                const last = historicalData.lpTotalSupplys[historicalData.lpTotalSupplys.length - 1];
                if (last.totalSupply !== lpTotalSupply.toString()) {
                    historicalData.lpTotalSupplys.push(newHistoricalLpTotalSupply);
                }
            } else {
                historicalData.lpTotalSupplys.push(newHistoricalLpTotalSupply);
            }

            const newHistoricalGaugeTotalSupply: HistoricalTotalSupply = {
                timestamp: blockTimestamp,
                totalSupply: gaugeTotalSupply.toString()
            };
            if (historicalData.gaugeTotalSupplys.length > 0) {
                const last = historicalData.gaugeTotalSupplys[historicalData.gaugeTotalSupplys.length - 1];
                if (last.totalSupply !== gaugeTotalSupply.toString()) {
                    historicalData.gaugeTotalSupplys.push(newHistoricalGaugeTotalSupply);
                }
            } else {
                historicalData.gaugeTotalSupplys.push(newHistoricalGaugeTotalSupply);
            }

            const newPercentage = parseFloat(formatUnits(newWeight, 18));
            historicalData.newWeight = futurWeight.toString();
            historicalData.newPercentage = newPercentage;
            historicalData.gaugeCrvApy = pool.gaugeCrvApy;
            historicalData.futureGaugeCrvApy = [newMinApy, newMaxApy];
            historicalData.inflation_rate = gauge.gauge_controller.inflation_rate;
            initData[currentPeriod] = historicalData;

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