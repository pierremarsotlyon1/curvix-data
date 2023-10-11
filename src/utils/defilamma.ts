import axios from "axios";

interface ITokenData {
    price: number;
    decimals: number;
}

export const getTokenData = async (tokenAddress: string): Promise<ITokenData> => {
    try {
        const r = await axios.get(`https://coins.llama.fi/prices/current/ethereum:${tokenAddress}`);
        return {
            price: r.data.coins[`ethereum:${tokenAddress}`].price,
            decimals: r.data.coins[`ethereum:${tokenAddress}`].decimals,
        };
    }
    catch (e) {
        console.log(e);
        return { price: 0, decimals: 18 }
    }
}