import type { BrokerCode, SessionLoginPayload } from "@/service/types/broker";

export type RedirectBrokerCode = "arrow" | "dhan" | "upstox" | "zerodha";

export type BrokerSessionSetup = {
    activationLabel: string;
    activationDescription: string;
    automaticCompletion?: boolean;
    callbackParams?: string[];
    manualFallbackDescription: string;
    manualFallbackLabel: string;
    manualSubmitLabel: string;
    requiresCallbackUrl?: boolean;
};

export const brokerSessionSetup: Record<BrokerCode, BrokerSessionSetup> = {
    angel: {
        activationLabel: "Activate Angel One",
        activationDescription: "Enter your Angel One client code, PIN, and current 6-digit TOTP to create a session.",
        manualFallbackDescription: "Use this when the saved automation credentials are not available or fail.",
        manualFallbackLabel: "Manual session details",
        manualSubmitLabel: "Activate Angel One"
    },
    arrow: {
        activationLabel: "Login with Arrow",
        activationDescription: "Complete Arrow login and Ananta will exchange the returned 24-hour request-token.",
        automaticCompletion: true,
        callbackParams: ["request-token"],
        manualFallbackDescription: "Use this only if the Arrow callback did not complete automatically.",
        manualFallbackLabel: "Manual request-token fallback",
        manualSubmitLabel: "Activate Arrow session",
        requiresCallbackUrl: true
    },
    dhan: {
        activationLabel: "Login with Dhan",
        activationDescription:
            "Ananta opens Dhan consent login and finishes setup automatically when Dhan redirects back.",
        automaticCompletion: true,
        callbackParams: ["tokenId", "tokenid", "token_id"],
        manualFallbackDescription:
            "Use this only if Dhan redirected back with a visible tokenId and Ananta did not connect automatically.",
        manualFallbackLabel: "Manual fallback",
        manualSubmitLabel: "Activate Dhan session",
        requiresCallbackUrl: true
    },
    groww: {
        activationLabel: "Activate Groww",
        activationDescription: "Use saved Groww credentials for automatic refresh, or switch to TOTP/access-token mode.",
        manualFallbackDescription: "Use this only if automatic Groww refresh is unavailable for this account.",
        manualFallbackLabel: "Manual Groww session",
        manualSubmitLabel: "Activate Groww"
    },
    indmoney: {
        activationLabel: "Update INDmoney token",
        activationDescription: "Paste a fresh INDmoney bearer access token from the broker portal.",
        manualFallbackDescription: "INDmoney is manual-token only in Ananta right now.",
        manualFallbackLabel: "Access token",
        manualSubmitLabel: "Update INDmoney token"
    },
    kotak: {
        activationLabel: "Activate Kotak Neo",
        activationDescription: "Enter mobile number, current TOTP, and MPIN to create a Kotak trading session.",
        manualFallbackDescription: "Use this when saved Kotak automation credentials are not available or fail.",
        manualFallbackLabel: "Manual session details",
        manualSubmitLabel: "Activate Kotak Neo"
    },
    upstox: {
        activationLabel: "Login with Upstox",
        activationDescription:
            "Complete Upstox OAuth login. Ananta reads the returned code and finishes setup automatically.",
        automaticCompletion: true,
        callbackParams: ["code", "authorization_code"],
        manualFallbackDescription:
            "Use this only if Upstox redirected back with a visible code and Ananta did not connect automatically.",
        manualFallbackLabel: "Manual fallback",
        manualSubmitLabel: "Activate Upstox session",
        requiresCallbackUrl: true
    },
    zerodha: {
        activationLabel: "Login with Zerodha",
        activationDescription:
            "Complete Zerodha Kite login. Ananta reads the returned request_token and finishes setup automatically.",
        automaticCompletion: true,
        callbackParams: ["request_token"],
        manualFallbackDescription:
            "Use this only if Zerodha redirected back with a visible request_token and Ananta did not connect automatically.",
        manualFallbackLabel: "Manual fallback",
        manualSubmitLabel: "Activate Zerodha session",
        requiresCallbackUrl: true
    }
};

export function brokerCallbackUrl(origin: string): string {
    return `${origin.replace(/\/$/, "")}/broker-connections`;
}

export function brokerCallbackPayload(
    params: URLSearchParams
): { broker: RedirectBrokerCode; token: string; payload: SessionLoginPayload } | null {
    const requestToken = params.get("request_token");
    if (requestToken) {
        return {
            broker: "zerodha",
            token: requestToken,
            payload: { broker: "zerodha", request_token: requestToken }
        };
    }

    const arrowRequestToken = params.get("request-token");
    if (arrowRequestToken) {
        return {
            broker: "arrow",
            token: arrowRequestToken,
            payload: {
                broker: "arrow",
                request_token: arrowRequestToken,
                checksum: params.get("checksum")
            }
        };
    }

    const code = params.get("code") ?? params.get("authorization_code");
    if (code) {
        return {
            broker: "upstox",
            token: code,
            payload: { broker: "upstox", authorization_code: code }
        };
    }

    const tokenId = params.get("tokenId") ?? params.get("tokenid") ?? params.get("token_id");
    if (tokenId) {
        return {
            broker: "dhan",
            token: tokenId,
            payload: { broker: "dhan", token_id: tokenId }
        };
    }

    return null;
}
