import NetInfo from '@react-native-community/netinfo';

export const expoConnectivityProvider = {
  async isOnline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  },

  /** Calls the listener when online/offline changes. Returns an unsubscribe function. */
  subscribe(listener: (online: boolean) => void): () => void {
    return NetInfo.addEventListener((state) => {
      listener(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
  },
};