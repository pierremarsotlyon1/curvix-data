import dotenv from "dotenv";
import { PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

dotenv.config();

const RPC_URLS = [`https://eth.llamarpc.com`, "https://rpc.ankr.com/eth"];
export const WEEK = 604800;

export const getRpcClient = async (): Promise<PublicClient | null> => {
    for (const rpcUrl of RPC_URLS) {
        const publicClient = createPublicClient({
            chain: mainnet,
            transport: http(rpcUrl),
            batch: {
                multicall: true
            }
        });

        try {
            await publicClient.getBlock();
            return publicClient;
        }
        catch (e) {

        }
    }

    return null;
};