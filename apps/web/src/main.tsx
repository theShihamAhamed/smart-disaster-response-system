import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createVerificationApi } from "./features/verification/verification-api";
import { createBroadcastApi } from "./features/hazard-broadcast/broadcast-api";
import { sharedApiClient } from "./shared-api-client";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App
      verificationApi={createVerificationApi(sharedApiClient)}
      broadcastApi={createBroadcastApi(sharedApiClient)}
    />
  </StrictMode>,
);
