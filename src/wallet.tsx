import { discoverQorexEip1193, findQorexEip1193, type Eip1193ProviderLike } from "@qorechain/qorex-types";
import { qorechainTestnet } from "@qorechain/evm";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";

type BrowserProvider = Eip1193ProviderLike & { readonly isQoreX?: boolean };
type Connector = {
  id: "qorex" | "injected";
  name: string;
  provider: () => Promise<BrowserProvider | undefined>;
};

declare global {
  interface Window {
    ethereum?: BrowserProvider;
  }
}

const publicClient = createPublicClient({
  chain: qorechainTestnet,
  transport: http(qorechainTestnet.rpcUrls.default.http[0]),
});

const connectors: Connector[] = [
  {
    id: "qorex",
    name: "QoreX",
    provider: async () => findQorexEip1193() ?? window.qorex?.evm ?? await discoverQorexEip1193(),
  },
  {
    id: "injected",
    name: "Injected wallet",
    provider: async () => window.ethereum,
  },
];

type WalletContextValue = {
  address?: Address;
  provider?: BrowserProvider;
  isConnecting: boolean;
  isDisconnecting: boolean;
  connectAsync: (options: { connector: Connector }) => Promise<void>;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

function accountFrom(value: unknown): Address | undefined {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] as Address : undefined;
}

async function switchToDiana(provider: BrowserProvider): Promise<void> {
  const current = Number(await provider.request({ method: "eth_chainId" }));
  if (current === qorechainTestnet.id) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${qorechainTestnet.id.toString(16)}` }],
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number(error.code) : undefined;
    if (code !== 4902 || provider.isQoreX) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: `0x${qorechainTestnet.id.toString(16)}`,
        chainName: qorechainTestnet.name,
        nativeCurrency: qorechainTestnet.nativeCurrency,
        rpcUrls: [...qorechainTestnet.rpcUrls.default.http],
        blockExplorerUrls: [qorechainTestnet.blockExplorers.default.url],
      }],
    });
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address>();
  const [provider, setProvider] = useState<BrowserProvider>();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const connectAsync = useCallback(async ({ connector }: { connector: Connector }) => {
    setIsConnecting(true);
    try {
      const nextProvider = await connector.provider();
      if (!nextProvider) throw new Error(`${connector.name} is not installed or available.`);
      await switchToDiana(nextProvider);
      const nextAddress = accountFrom(await nextProvider.request({ method: "eth_requestAccounts" }));
      if (!nextAddress) throw new Error(`${connector.name} did not return an account.`);
      setProvider(nextProvider);
      setAddress(nextAddress);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setIsDisconnecting(true);
    setAddress(undefined);
    setProvider(undefined);
    setIsDisconnecting(false);
  }, []);

  useEffect(() => {
    if (!provider) return;
    const accountsChanged = (...values: unknown[]) => setAddress(accountFrom(values[0]));
    const chainChanged = () => {
      void provider.request({ method: "eth_chainId" }).then((chainId) => {
        if (Number(chainId) !== qorechainTestnet.id) disconnect();
      });
    };
    provider.on?.("accountsChanged", accountsChanged);
    provider.on?.("chainChanged", chainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
    };
  }, [provider, disconnect]);

  useEffect(() => {
    if (!provider) return;
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const nextAddress = accountFrom(await provider.request({ method: "eth_accounts" }));
        const chainId = Number(await provider.request({ method: "eth_chainId" }));
        if (!nextAddress || chainId !== qorechainTestnet.id) disconnect();
        else setAddress(nextAddress);
      } finally {
        running = false;
      }
    };
    const onFocus = () => void refresh();
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [provider, disconnect]);

  const value = useMemo(() => ({
    address,
    provider,
    isConnecting,
    isDisconnecting,
    connectAsync,
    disconnect,
  }), [address, provider, isConnecting, isDisconnecting, connectAsync, disconnect]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

function useWalletContext(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error("Wallet hooks must be used inside WalletProvider.");
  return value;
}

export function useAccount() {
  const { address } = useWalletContext();
  return { address, isConnected: Boolean(address) };
}

export function useConnect() {
  const { connectAsync, isConnecting } = useWalletContext();
  return { connectors, connectAsync, isPending: isConnecting };
}

export function useDisconnect() {
  const { disconnect, isDisconnecting } = useWalletContext();
  return { disconnect, isPending: isDisconnecting };
}

export function useWriteContract() {
  const { address, provider } = useWalletContext();
  const [data, setData] = useState<Hex>();
  const [error, setError] = useState<Error>();
  const [isPending, setIsPending] = useState(false);

  const writeContractAsync = useCallback(async (parameters: any): Promise<Hex> => {
    if (!address || !provider) throw new Error("Connect a wallet before submitting a transaction.");
    setIsPending(true);
    setError(undefined);
    try {
      const { request } = await publicClient.simulateContract({ ...parameters, account: address });
      const walletClient = createWalletClient({
        account: address,
        chain: qorechainTestnet,
        transport: custom(provider as EIP1193Provider),
      });
      const hash = await walletClient.writeContract(request);
      setData(hash);
      return hash;
    } catch (caught) {
      const nextError = caught instanceof Error ? caught : new Error(String(caught));
      setError(nextError);
      throw nextError;
    } finally {
      setIsPending(false);
    }
  }, [address, provider]);

  return { data, error, isPending, writeContractAsync };
}

export function useWaitForTransactionReceipt({ hash }: { hash?: Hex }) {
  const [isSuccess, setIsSuccess] = useState(false);
  useEffect(() => {
    let active = true;
    setIsSuccess(false);
    if (!hash) return () => { active = false; };
    void publicClient.waitForTransactionReceipt({ hash }).then((receipt) => {
      if (active) setIsSuccess(receipt.status === "success");
    }).catch(() => undefined);
    return () => { active = false; };
  }, [hash]);
  return { isSuccess };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry);
}

export function useReadContract(parameters: any) {
  const enabled = parameters.query?.enabled ?? true;
  const key = stableJson({
    address: parameters.address,
    functionName: parameters.functionName,
    args: parameters.args,
    enabled,
  });
  const [data, setData] = useState<any>();

  const refetch = useCallback(async () => {
    if (!enabled) return { data: undefined };
    try {
      const next = await publicClient.readContract(parameters);
      setData(next);
      return { data: next };
    } catch {
      setData(undefined);
      return { data: undefined };
    }
  }, [key]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, refetch };
}
