/** Port: is the phone connected to a network? */
export interface ConnectivityProvider {
  isOnline(): Promise<boolean>;
  /** Calls the listener whenever the connection changes. Returns a function that stops listening. */
  subscribe(listener: (online: boolean) => void): () => void;
}
