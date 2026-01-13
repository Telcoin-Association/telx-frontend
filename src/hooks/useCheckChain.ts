import { useEffect } from 'react';
import { type Chain } from 'viem';
import { useWalletClient } from 'wagmi';

// Check the connected wallet's chain and prompt user to switch if incorrect.
export function useCheckChain(targetChain: Chain) {
  const { data: walletClient } = useWalletClient();

  useEffect(() => {
    if (!walletClient) return;

    const checkAndSwitchChain = async () => {
      try {
        const currentChainId = await walletClient.getChainId();

        if (currentChainId !== targetChain.id) {
          await walletClient.switchChain({ id: targetChain.id });
        }
      } catch (error) {
        console.error('Chain switch error:', error);
      }
    };

    checkAndSwitchChain();
  }, [walletClient, targetChain.id]);
}
