import type { BrokerCode } from "@/service/types/broker";

export type BrokerGuide = {
    broker: BrokerCode;
    title: string;
    summary: string;
    required: string[];
    setupSteps: string[];
    formMapping: { label: string; field: string; note: string }[];
    sessionSteps: string[];
    notes: string[];
};

export const brokerGuides: Record<BrokerCode, BrokerGuide> = {
    angel: {
        broker: "angel",
        title: "Angel One SmartAPI Setup",
        summary: "Connect Angel One with a manual TOTP flow, or store PIN plus TOTP secret for automated SmartAPI refresh.",
        required: ["Account label", "API key", "Client code", "Choose manual or automation mode"],
        setupSteps: [
            "Create or open your Angel One SmartAPI app.",
            "Copy the API key from the app.",
            "Choose manual TOTP or stored-TOTP automation mode.",
            "Keep client code, PIN, and current TOTP ready for manual sessions.",
            "Store PIN and TOTP secret only if you want automated refresh."
        ],
        formMapping: [
            { label: "API key", field: "api_key", note: "SmartAPI application key." },
            { label: "Client code", field: "client_code", note: "Angel One user or client ID." },
            { label: "PIN", field: "pin", note: "Stored only in automation mode. Manual mode asks for PIN during session refresh." },
            {
                label: "TOTP secret",
                field: "totp_secret",
                note: "Automation-only secret, not the current 6-digit OTP."
            }
        ],
        sessionSteps: [
            "In manual mode, open the broker detail page after saving credentials.",
            "Enter client code, PIN, and the current 6-digit TOTP.",
            "Submit the session form to generate broker session tokens.",
            "In automation mode, the backend can attempt refresh using the stored PIN and TOTP secret."
        ],
        notes: [
            "The current 6-digit TOTP is not the same as the TOTP secret.",
            "Store PIN and TOTP secret only if you need automation."
        ]
    },
    arrow: {
        broker: "arrow",
        title: "Arrow Trade Developer API Setup",
        summary: "Connect Arrow through its official redirect flow, with optional encrypted TOTP automation and standard or HFT market streaming.",
        required: ["Account label", "Arrow app ID", "Arrow app secret", "Registered callback URL", "Registered static IP"],
        setupSteps: [
            "Open Trading APIs from your Arrow Trade profile and create an application.",
            "Register the exact Ananta /broker-connections callback URL shown in the form.",
            "Register the backend's static outbound IP as required by Arrow and SEBI rules.",
            "Copy the app ID and app secret, then choose standard streaming or entitled HFT streaming.",
            "Save the account and use Login with Arrow to generate a 24-hour access token."
        ],
        formMapping: [
            { label: "App ID", field: "app_id", note: "Arrow Developer appID." },
            { label: "App secret", field: "app_secret", note: "Arrow Developer appSecret, encrypted at rest." },
            { label: "Login user ID", field: "login_user_id", note: "Automation only; omit for redirect-only setup." },
            { label: "Login password", field: "login_password", note: "Automation only and encrypted at rest." },
            { label: "TOTP secret", field: "totp_secret", note: "Automation-only Base32 secret, not a current OTP." }
        ],
        sessionSteps: [
            "Click Login with Arrow from the account page.",
            "Complete Arrow user ID, password, and TOTP authentication.",
            "Arrow redirects to Ananta with request-token and checksum; Ananta validates and exchanges it automatically.",
            "Repeat after 24 hours unless opt-in automation is configured."
        ],
        notes: [
            "Arrow access tokens expire after 24 hours and no general refresh token is assumed.",
            "All REST product groups are limited to 10 requests per second.",
            "MARKET orders use Arrow Market Price Protection and may remain open as limit orders.",
            "HFT requires entitlement, zstd compression, and is limited to 1,024 symbols per connection."
        ]
    },
    dhan: {
        broker: "dhan",
        title: "Dhan API Setup",
        summary: "Connect Dhan with manual consent, or store PIN plus TOTP secret for the official automation path.",
        required: ["Account label", "API key", "API secret", "Client ID", "Choose consent or automation mode"],
        setupSteps: [
            "Enable Dhan API access.",
            "Copy the API key, API secret, and client ID.",
            "Set the Dhan app redirect URL to the frontend /broker-connections URL shown in Ananta.",
            "Set up static IP allowlisting if Dhan requires it.",
            "Choose manual consent or TOTP automation mode.",
            "Add PIN and TOTP secret only if you want automated refresh."
        ],
        formMapping: [
            { label: "API key", field: "app_id", note: "Copy this from your Dhan API or developer dashboard." },
            { label: "API secret", field: "app_secret", note: "Copy this secret from the same Dhan API app." },
            {
                label: "Client ID",
                field: "client_id",
                note: "Use the Dhan client ID assigned to your trading account. Do not enter Ananta or your app name."
            },
            { label: "PIN", field: "pin", note: "Optional 6-digit Dhan login PIN, used only for automation." },
            { label: "TOTP secret", field: "totp_secret", note: "Optional authenticator or QR setup secret, not the current 6-digit OTP." }
        ],
        sessionSteps: [
            "In manual consent mode, use the broker detail page to start the Dhan consent flow.",
            "Complete Dhan login and 2FA in the opened page.",
            "When Dhan redirects back to Ananta, Ananta reads tokenId and finishes setup automatically.",
            "Use Manual fallback only if Ananta did not connect automatically and tokenId is visible in the returned URL.",
            "In automation mode, the backend can attempt refresh using stored client_id, PIN, and TOTP secret."
        ],
        notes: [
            "The registered redirect URL must point to the public frontend; the backend does not need to be exposed.",
            "Manual consent avoids storing PIN and TOTP secret.",
            "The callback URL must include /broker-connections, not only the Ananta domain.",
            "PIN plus TOTP secret can enable unattended refresh."
        ]
    },
    groww: {
        broker: "groww",
        title: "Groww Trade API Setup",
        summary: "Add Groww with API approval, TOTP automation, or a manual access token.",
        required: ["Account label", "One Groww credential mode"],
        setupSteps: [
            "Open the Groww Trade API key dashboard.",
            "Add or update the mandatory static IP.",
            "Choose API approval, TOTP, or access token mode.",
            "Enter only the fields required for that mode.",
            "Save the broker account."
        ],
        formMapping: [
            { label: "API key", field: "api_key", note: "Used with API secret in approval mode." },
            { label: "API secret", field: "api_secret", note: "Used with API key in approval mode." },
            { label: "TOTP API key", field: "totp_token", note: "Groww user API key for the TOTP flow." },
            { label: "TOTP secret", field: "totp_secret", note: "Authenticator or QR secret for TOTP mode." },
            { label: "Access token", field: "access_token", note: "Current token for manual mode." }
        ],
        sessionSteps: [
            "Save the broker account with one valid credential mode.",
            "Use the broker detail page to refresh or submit the session depending on the configured mode.",
            "For manual token mode, paste a fresh access token when the old one expires."
        ],
        notes: [
            "Static IP is mandatory for Groww API access.",
            "API approval is the normal official setup, TOTP is best for automation, and access token is best for quick manual testing."
        ]
    },
    indmoney: {
        broker: "indmoney",
        title: "INDmoney Token Setup",
        summary: "Connect INDmoney with a manually generated bearer access token.",
        required: ["Account label", "Access token"],
        setupSteps: [
            "Open the INDstocks API trading page.",
            "Generate or copy a fresh INDmoney bearer access token.",
            "Set up static IP allowlisting if INDmoney requires it.",
            "Paste the access token into Ananta Market Stack."
        ],
        formMapping: [
            { label: "Access token", field: "access_token", note: "Paste only the token value, not the word Bearer." }
        ],
        sessionSteps: [
            "Save the account with an access token.",
            "If the token expires, open the broker detail page and paste a fresh token into the INDmoney session form."
        ],
        notes: [
            "Treat access tokens like passwords.",
            "INDmoney is manual-token only in Ananta Market Stack right now; there is no automated login or TOTP flow."
        ]
    },
    kotak: {
        broker: "kotak",
        title: "Kotak Neo Setup",
        summary: "Connect Kotak Neo with manual session entry, or store mobile number, MPIN, and TOTP secret for automated session rebuilds.",
        required: ["Account label", "UCC", "Portal access token", "Choose manual or automation mode"],
        setupSteps: [
            "Enable Kotak Neo Trade API access.",
            "Copy your UCC and portal access token.",
            "Choose manual session or stored TOTP plus MPIN automation mode.",
            "Keep registered mobile number, MPIN, and current TOTP ready.",
            "Store mobile number, MPIN, and TOTP secret only if you want automated refresh."
        ],
        formMapping: [
            { label: "UCC", field: "ucc", note: "Unique Client Code for Kotak." },
            {
                label: "Portal access token",
                field: "portal_access_token",
                note: "Bearer token from Kotak Neo developer portal."
            },
            {
                label: "Mobile number",
                field: "mobile_number",
                note: "Stored only in automation mode. Manual mode asks for it during session login."
            },
            { label: "MPIN", field: "mpin", note: "Stored only in automation mode; manual mode asks for it during session login." },
            { label: "TOTP secret", field: "totp_secret", note: "Automation-only secret." }
        ],
        sessionSteps: [
            "In manual mode, open the broker detail page after account creation.",
            "Enter registered mobile number, current 6-digit TOTP, and MPIN.",
            "Submit the session form to create a trading session.",
            "In automation mode, the backend can rebuild the session using stored mobile number, MPIN, and TOTP secret."
        ],
        notes: [
            "Portal access token and trade session credentials are separate pieces of the Kotak flow.",
            "Store MPIN and TOTP secret only if you need automation."
        ]
    },
    upstox: {
        broker: "upstox",
        title: "Upstox OAuth Setup",
        summary: "Connect Upstox with API key, API secret, and an exact redirect URI match.",
        required: ["Account label", "API key", "API secret", "Redirect URI"],
        setupSteps: [
            "Create an Upstox developer app.",
            "Copy the API key and API secret.",
            "Set the redirect URI to your Ananta broker callback URL.",
            "Save the exact same redirect URI in Ananta Market Stack."
        ],
        formMapping: [
            { label: "API key", field: "api_key", note: "Upstox client ID or API key." },
            { label: "API secret", field: "api_secret", note: "Upstox API secret." },
            {
                label: "Redirect URI",
                field: "redirect_uri",
                note: "Use the exact Ananta broker callback URL shown here; it must match Upstox exactly."
            }
        ],
        sessionSteps: [
            "Save the account, then open the broker detail page.",
            "Open the Upstox login URL from the session panel.",
            "After authorization, Ananta Market Stack reads the code from /broker-connections and connects the account automatically."
        ],
        notes: [
            "The redirect URI in Upstox and Ananta Market Stack must be identical.",
            "Use the same Ananta host before and after broker login."
        ]
    },
    zerodha: {
        broker: "zerodha",
        title: "Zerodha Kite Connect Setup",
        summary: "Connect Zerodha with the normal Kite redirect flow, or add optional web-login automation credentials for daily refresh.",
        required: ["Account label", "API key", "API secret", "Optional automation bundle if you want auto refresh"],
        setupSteps: [
            "Create or open your Kite Connect app.",
            "Copy the API key and API secret.",
            "Set the app redirect URL to your Ananta broker callback URL.",
            "Choose API-only mode or optional web-login automation mode.",
            "If using automation, keep Zerodha user ID, password, and TOTP secret ready.",
            "Save the credentials in Ananta Market Stack."
        ],
        formMapping: [
            { label: "API key", field: "api_key", note: "Kite Connect API key." },
            { label: "API secret", field: "api_secret", note: "Kite Connect API secret." },
            {
                label: "Login user ID",
                field: "login_user_id",
                note: "Optional Zerodha user ID for experimental web-login automation."
            },
            {
                label: "Login password",
                field: "login_password",
                note: "Optional Zerodha password for experimental web-login automation."
            },
            {
                label: "TOTP secret",
                field: "totp_secret",
                note: "Optional Base32 authenticator secret for experimental automation."
            }
        ],
        sessionSteps: [
            "In API-only mode, open the broker detail page after saving credentials.",
            "Open the Zerodha login URL shown in the session panel.",
            "After authorization, Ananta Market Stack reads the request_token from /broker-connections and connects the account automatically.",
            "In automation mode, the backend can also attempt refresh using the stored user ID, password, and TOTP secret."
        ],
        notes: [
            "Zerodha sessions usually need fresh authorization each trading day.",
            "The automation path is experimental because it depends on Zerodha web-login behavior.",
            "The TOTP secret is not the same as the current 6-digit OTP.",
            "Use the same Ananta host before and after broker login."
        ]
    }
};

export function getBrokerGuide(broker: string): BrokerGuide | null {
    return broker in brokerGuides ? brokerGuides[broker as BrokerCode] : null;
}
